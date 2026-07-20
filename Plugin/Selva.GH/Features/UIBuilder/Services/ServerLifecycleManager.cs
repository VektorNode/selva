using System;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Manages the lifecycle of LocalWebServer and WebSocketServer.
///     Handles server startup, shutdown, and concurrent access prevention.
///
///     Concurrency model: start and stop transitions are serialized by <see cref="_transitionGate" />,
///     and <see cref="_desiredRunning" /> records the latest caller intent. Both are needed — the gate
///     alone can't order a delayed stop (disconnect-notify grace period) against a newer start, and
///     "if (IsRunning) Stop()" check-then-act let a stop overlapping a start no-op entirely, orphaning
///     servers on a disabled component.
/// </summary>
public class ServerLifecycleManager : IDisposable
{
    private readonly WebSocketTransport _webSocketTransport;
    private readonly SemaphoreSlim _transitionGate = new SemaphoreSlim(1, 1);
    private readonly LocalWebServer _webServer;
    private bool _disposed;

    // Latest intent: set true at the top of StartServersAsync, false at the top of the stop
    // entry points — before either takes the gate. Transitions re-check it under the gate so the
    // most recent request wins regardless of execution order.
    private volatile bool _desiredRunning;

    public ServerLifecycleManager(LocalWebServer webServer, WebSocketTransport webSocketTransport)
    {
        _webServer = webServer ?? throw new ArgumentNullException(nameof(webServer));
        _webSocketTransport = webSocketTransport ?? throw new ArgumentNullException(nameof(webSocketTransport));
    }

    public bool IsRunning => _webSocketTransport.IsRunning;

    public int? WebSocketPort => _webSocketTransport.IsRunning ? _webSocketTransport.WebSocketPort : null;

    public int? HttpPort => _webServer != null && _webServer.IsRunning ? _webServer.Port : null;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _desiredRunning = false;

        // Synchronous best-effort cleanup — no async/.Wait() (deadlocks on the main thread) and no
        // gate wait (Dispose must not block). An in-flight start observes _desiredRunning == false
        // after binding and tears itself down.
        StopCore();
    }

    public async Task<bool> StartServersAsync(string sessionId)
    {
        if (string.IsNullOrEmpty(sessionId))
        {
            throw new ArgumentNullException(nameof(sessionId));
        }

        _desiredRunning = true;

        await _transitionGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!_desiredRunning)
            {
                // A stop was requested after this start queued — the newer intent wins.
                return false;
            }

            if (IsRunning)
            {
                return true;
            }

            // Start embedded web server first (production mode only - check if resources exist)
            var hasEmbeddedAssets = HasEmbeddedWebAssets();
            if (_webServer != null && !_webServer.IsRunning && hasEmbeddedAssets)
            {
                _webServer.Start();
                Logger.Log($"[ServerLifecycleManager] HTTP server started on port {_webServer.Port}");
            }

            // Start WebSocket server for real-time communication
            await _webSocketTransport.StartAsync(msg =>
            {
#if DEBUG
                Logger.Log($"[ServerLifecycleManager] {msg}");
#endif
            }).ConfigureAwait(false);

            if (!_desiredRunning)
            {
                // Disabled while binding — tear down what we just built instead of leaving
                // servers accepting clients on a disabled component.
                StopCore();
                return false;
            }

            Logger.Log(
                $"[ServerLifecycleManager] WebSocket server started on port {_webSocketTransport.WebSocketPort}");
            return true;
        }
        catch (Exception ex)
        {
            Logger.Error("[ServerLifecycleManager] Failed to start servers", ex);

            // Cleanup on failure. Direct StopCore — StopServersAsync would deadlock on the gate.
            StopCore();
            return false;
        }
        finally
        {
            _transitionGate.Release();
        }
    }

    public async Task StopServersAsync()
    {
        _desiredRunning = false;

        await _transitionGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (_desiredRunning)
            {
                // Re-enabled while this stop was queued or delayed (fast disable→enable) —
                // leave the servers up rather than stranding an enabled component.
                return;
            }

            // Socket closes block up to ClientCloseTimeoutMs per client — keep them off the
            // calling thread (this is reached from UI-thread continuations).
            await Task.Run(StopCore).ConfigureAwait(false);
        }
        finally
        {
            _transitionGate.Release();
        }
    }

    public async Task StopServersAndNotifyAsync(string reason = null)
    {
        // Record the intent before the notify grace period, so a start queued during the
        // delay is ordered correctly against this stop.
        _desiredRunning = false;

        if (_webSocketTransport.IsRunning)
        {
            try
            {
                await _webSocketTransport.BroadcastMessage("disconnecting",
                    new { reason = reason ?? "Server shutting down" });
                await Task.Delay(100); // Give clients time to receive the message
            }
            catch (Exception ex)
            {
                Logger.Error("[ServerLifecycleManager] Error sending disconnect notification", ex);
            }
        }

        await StopServersAsync();
    }

    /// <summary>
    ///     Stops both servers. Callers must hold <see cref="_transitionGate" /> (or be on the
    ///     Dispose / in-flight-start paths, which are documented exceptions).
    /// </summary>
    private void StopCore()
    {
        try
        {
            if (_webSocketTransport.IsRunning)
            {
                _webSocketTransport.Stop();
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
