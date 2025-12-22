using System;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Rhino;
using Selva.Grasshopper.Features.UIBuilder.Services.Communication;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Services;

/// <summary>
/// Manages the lifecycle of LocalWebServer and WebSocketServer.
/// Handles server startup, shutdown, and concurrent access prevention.
/// </summary>
public class ServerLifecycleManager : IDisposable
{
	private readonly LocalWebServer _webServer;
	private readonly CommunicationHandler _communicationHandler;
	private bool _isStarting;
	private readonly object _lock = new();
	private bool _disposed;

	public ServerLifecycleManager(LocalWebServer webServer, CommunicationHandler communicationHandler)
	{
		_webServer = webServer ?? throw new ArgumentNullException(nameof(webServer));
		_communicationHandler = communicationHandler ?? throw new ArgumentNullException(nameof(communicationHandler));
	}

	public bool IsRunning => _communicationHandler.IsRunning;

	public int? WebSocketPort => _communicationHandler.IsRunning ? _communicationHandler.WebSocketPort : null;

	public int? HttpPort => _webServer.IsRunning ? _webServer.Port : null;

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
			if (!_webServer.IsRunning && hasEmbeddedAssets)
			{
				_webServer.Start();
				Logger.Log($"[ServerLifecycleManager] HTTP server started on port {_webServer.Port}");
			}

			// Start WebSocket server for real-time communication
			await _communicationHandler.StartAsync(msg =>
			{
				Logger.Log($"[ServerLifecycleManager] {msg}");
				RhinoApp.InvokeOnUiThread(new Action(() =>
				{
					RhinoApp.WriteLine($"[Selva] {msg}");
				}));
			});

			Logger.Log($"[ServerLifecycleManager] WebSocket server started on port {_communicationHandler.WebSocketPort}");
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
				if (_webServer.IsRunning)
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
		{
			try
			{
				await _communicationHandler.BroadcastMessage("disconnecting", new { reason = reason ?? "Server shutting down" });
				Thread.Sleep(100); // Give clients time to receive the message
			}
			catch (Exception ex)
			{
				Logger.Error("[ServerLifecycleManager] Error sending disconnect notification", ex);
			}
		}

		await StopServersAsync();
	}

	public void Dispose()
	{
		if (_disposed) return;

		try
		{
			StopServersAndNotifyAsync("Service disposed").Wait();
		}
		catch
		{
			// Best effort cleanup
		}

		_disposed = true;
	}

	/// <summary>
	/// Check if embedded web assets are available in the assembly
	/// </summary>
	private static bool HasEmbeddedWebAssets()
	{
		var assembly = Assembly.GetExecutingAssembly();
		var resourceNames = assembly.GetManifestResourceNames();
		return resourceNames.Any(name => name.Contains("Selva.EmbeddedAssets.web.index.html"));
	}
}
