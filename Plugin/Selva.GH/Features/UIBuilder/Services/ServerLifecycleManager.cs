using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Manages the lifecycle of LocalWebServer and WebSocketServer.
///     Handles server startup, shutdown, and concurrent access prevention.
/// </summary>
public class ServerLifecycleManager : IDisposable
{
    private readonly CommunicationHandler _communicationHandler;
    private readonly object _lock = new();
    private readonly LocalWebServer _webServer;
    private bool _disposed;
    private bool _isStarting;

    public ServerLifecycleManager(LocalWebServer webServer, CommunicationHandler communicationHandler)
    {
        _webServer = webServer; // Can be null on non-Windows platforms
        _communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
    }

    public bool IsRunning => _communicationHandler.IsRunning;

    public int? WebSocketPort => _communicationHandler.IsRunning ? _communicationHandler.WebSocketPort : null;

    public int? HttpPort => _webServer != null && _webServer.IsRunning ? _webServer.Port : null;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // Synchronous cleanup only — avoid async/.Wait() which deadlocks on the main thread.
        // Clients will detect the dropped connection on their own.
        try
        {
            if (_communicationHandler.IsRunning) _communicationHandler.Stop();
        }
        catch
        {
        }

        try
        {
            if (_webServer != null && _webServer.IsRunning) _webServer.Stop();
        }
        catch
        {
        }
    }

    public async Task<bool> StartServersAsync(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) throw new ArgumentNullException(nameof(sessionId));

        // Prevent concurrent starts
        lock (_lock)
        {
            if (_isStarting || IsRunning) return IsRunning;
            _isStarting = true;
        }

        try
        {
            // Start embedded web server first (production mode only - check if resources exist)
            var hasEmbeddedAssets = HasEmbeddedWebAssets();
            if (_webServer != null && !_webServer.IsRunning && hasEmbeddedAssets)
            {
                _webServer.Start();
                Logger.Log($"[ServerLifecycleManager] HTTP server started on port {_webServer.Port}");
            }

            // Start WebSocket server for real-time communication
            await _communicationHandler.StartAsync(msg =>
            {
#if DEBUG
				Logger.Log($"[ServerLifecycleManager] {msg}");
#endif
            });

            Logger.Log(
                $"[ServerLifecycleManager] WebSocket server started on port {_communicationHandler.WebSocketPort}");
            return true;
        }
        catch (Exception ex)
        {
            Logger.Error("[ServerLifecycleManager] Failed to start servers", ex);

            // Cleanup on failure
            await StopServersAsync();
            return false;
        }
        finally
        {
            lock (_lock)
            {
                _isStarting = false;
            }
        }
    }

    public async Task StopServersAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                if (_communicationHandler.IsRunning)
                {
                    _communicationHandler.Stop();
                    Logger.Log("[ServerLifecycleManager] WebSocket server stopped");
                }
            }
            catch (Exception ex)
            {
                Logger.Error("[ServerLifecycleManager] Error stopping WebSocket server", ex);
            }

            try
            {
                if (_webServer != null && _webServer.IsRunning)
                {
                    _webServer.Stop();
                    Logger.Log("[ServerLifecycleManager] HTTP server stopped");
                }
            }
            catch (Exception ex)
            {
                Logger.Error("[ServerLifecycleManager] Error stopping HTTP server", ex);
            }
        });
    }

    public async Task StopServersAndNotifyAsync(string reason = null)
    {
        if (_communicationHandler.IsRunning)
            try
            {
                await _communicationHandler.BroadcastMessage("disconnecting",
                    new { reason = reason ?? "Server shutting down" });
                await Task.Delay(100); // Give clients time to receive the message
            }
            catch (Exception ex)
            {
                Logger.Error("[ServerLifecycleManager] Error sending disconnect notification", ex);
            }

        await StopServersAsync();
    }

    /// <summary>
    ///     Check if embedded web assets are available in the assembly
    /// </summary>
    private static bool HasEmbeddedWebAssets()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resourceNames = assembly.GetManifestResourceNames();
        return resourceNames.Any(name => name.Contains("Selva.EmbeddedAssets.web.index.html"));
    }
}
