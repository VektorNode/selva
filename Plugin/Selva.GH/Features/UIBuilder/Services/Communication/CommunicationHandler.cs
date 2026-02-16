using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino;
using Selva.Core.Models;
using Selva.GH.Config;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///   Handles WebSocket communication with the web UI
/// </summary>
public class CommunicationHandler : IDisposable
{
	/// <summary>
	///   Secure JSON serializer — prevents type confusion attacks, created once and reused.
	/// </summary>
	private static readonly JsonSerializer SecureSerializer = JsonSerializer.Create(new JsonSerializerSettings
	{
		TypeNameHandling = TypeNameHandling.None,
		MaxDepth = AppConfig.JsonSerialization.MaxJsonDepth,
		MetadataPropertyHandling = MetadataPropertyHandling.Ignore
	});

	private readonly int _port;
	private readonly string _sessionId;
	private bool _disposed;
	private bool? _lastBroadcastedSolvingState; // Track last state to prevent duplicates
	private int _mainThreadId;
	private int _suppressSolvingCyclesRemaining; // Number of solve cycles to suppress
	private int _initialDataInFlight; // Prevent concurrent requestInitialData handling
	private WebSocketServer _webSocketServer;

	public CommunicationHandler(string sessionId, int port = 8765)
	{
		_sessionId = sessionId;
		_port = port;
		// Capture the main/UI thread ID at construction time (constructor runs on main thread)
		_mainThreadId = Thread.CurrentThread.ManagedThreadId;
	}

	public bool IsRunning => _webSocketServer?.IsRunning ?? false;

	public int WebSocketPort => _webSocketServer?.Port ?? _port;

	public void Dispose()
	{
		Dispose(true);
		GC.SuppressFinalize(this);
	}

	/// <summary>
	///   Suppress the next N solution cycles (used during schema saves)
	///   More reliable than time-based suppression
	/// </summary>
	public void SuppressSolvingCycles(int cycles)
	{
		_suppressSolvingCyclesRemaining = Math.Max(0, cycles);
		Logger.Log($"[CommunicationHandler] Suppressing next {cycles} solving cycle(s)");
	}

	public event EventHandler<Dictionary<string, object>> OnValuesReceived;
	public event EventHandler OnCurrentValuesRequested;
	public event EventHandler OnClientConnected;
	public event EventHandler<UISchema> OnSchemaSaveRequested;
	public event EventHandler<UISchema> OnSyncPreviewRequested;
	public event EventHandler<List<SyncChange>> OnSyncChangesApply;

	/// <summary>
	///   Start WebSocket server
	/// </summary>
	public async Task StartAsync(Action<string> logMessage)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning) return;

		try
		{
			_webSocketServer = new WebSocketServer(_port);
			_webSocketServer.OnClientConnected += (sender, webSocket) =>
			{
#if DEBUG
				logMessage?.Invoke("Web UI client connected");
#endif
				// Don't invoke OnClientConnected here - wait for explicit requestInitialData message
				// This prevents duplicate initial data being sent
			};

			// Handle incoming messages — parse on thread pool, dispatch to main thread
			_webSocketServer.OnMessageReceived += (sender, message) =>
			{
				_ = Task.Run(() =>
				{
					try
					{
						var jObj = JObject.Parse(message);
						var msgType = jObj["type"]?.ToString();
						var sessionId = jObj["sessionId"]?.ToString();

						// Validate session — requestInitialData is exempt (establishes the session)
						if (msgType != "requestInitialData" && sessionId != _sessionId)
						{
							Logger.Warn($"[CommunicationHandler] Session ID mismatch for '{msgType}'");
							return;
						}

						switch (msgType)
						{
							case "valueUpdate":
								{
									var values = jObj["values"]?.ToObject<Dictionary<string, object>>(SecureSerializer);
									if (values != null)
										MarshalToMainThread(() => OnValuesReceived?.Invoke(this, values));
									else
										Logger.Warn("[CommunicationHandler] valueUpdate missing 'values'");
									break;
								}
							case "requestCurrentValues":
								MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
								break;

							case "requestInitialData":
								if (Interlocked.CompareExchange(ref _initialDataInFlight, 1, 0) != 0) return;
								try
								{
									MarshalToMainThread(() =>
									{
										try { OnClientConnected?.Invoke(this, EventArgs.Empty); }
										finally { Interlocked.Exchange(ref _initialDataInFlight, 0); }
									});
								}
								catch
								{
									Interlocked.Exchange(ref _initialDataInFlight, 0);
								}
								break;

							case "saveSchema":
								{
									var schema = jObj["schema"]?.ToObject<UISchema>(SecureSerializer);
									if (schema != null)
										MarshalToMainThread(() => OnSchemaSaveRequested?.Invoke(this, schema));
									break;
								}
							case "requestSyncPreview":
								{
									var schema = jObj["schema"]?.ToObject<UISchema>(SecureSerializer);
									if (schema != null)
										MarshalToMainThread(() => OnSyncPreviewRequested?.Invoke(this, schema));
									break;
								}
							case "applySyncChanges":
								{
									var changes = jObj["changes"]?.ToObject<List<SyncChange>>(SecureSerializer);
									if (changes != null)
										MarshalToMainThread(() => OnSyncChangesApply?.Invoke(this, changes));
									break;
								}
						}
					}
					catch (Exception ex)
					{
						Logger.Warn($"[CommunicationHandler] Message error: {ex.Message}");
					}
				});
			};

			// Start server with timeout - compatible with .NET Framework 4.8
			var startTask = _webSocketServer.StartAsync();
			if (await Task.WhenAny(startTask, Task.Delay(AppConfig.WebSocket.ServerStartupTimeoutMs)) != startTask)
				throw new TimeoutException(
					$"WebSocket server startup timed out after {AppConfig.WebSocket.ServerStartupTimeoutMs}ms");

			await startTask; // Propagate any exceptions
		}
		catch (TimeoutException ex)
		{
			logMessage?.Invoke(ex.Message);
			throw;
		}
		catch (Exception ex)
		{
			logMessage?.Invoke($"Could not start WebSocket server: {ex.Message}");
			throw;
		}
	}

	/// <summary>
	///   Stop WebSocket server
	/// </summary>
	public void Stop()
	{
		if (_webSocketServer != null)
			try
			{
				_webSocketServer.Stop();
				_webSocketServer.Dispose();
			}
			catch (Exception ex)
			{
				Logger.Warn($"Error stopping WebSocket: {ex.Message}");
			}
			finally
			{
				_webSocketServer = null;
				_lastBroadcastedSolvingState = null; // Reset for next session
				_suppressSolvingCyclesRemaining = 0; // Reset suppression
				Interlocked.Exchange(ref _initialDataInFlight, 0); // Reset for next session
			}
	}

	/// <summary>
	///   Marshals WebSocket operations to Grasshopper's main thread using RhinoApp.InvokeOnUiThread.
	///   Required because parameter updates must occur on the UI thread to avoid race conditions.
	/// </summary>
	/// <remarks>
	///   Uses Task.Run to avoid blocking the WebSocket receive loop, then marshals the callback
	///   to the main thread for actual parameter modification.
	/// </remarks>
	private void MarshalToMainThread(Action callback)
	{
		if (Thread.CurrentThread.ManagedThreadId == _mainThreadId)
		{
			callback?.Invoke();
			return;
		}

		try
		{
			RhinoApp.InvokeOnUiThread(callback);
		}
		catch
		{
			callback?.Invoke();
		}
	}

	/// <summary>
	///   Broadcast a generic message to all connected clients
	/// </summary>
	public async Task BroadcastMessage(string messageType, object data)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = messageType,
				sessionId = _sessionId,
				data
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast output values, file data, and display data to all connected clients in a single message
	/// </summary>
	public async Task BroadcastOutputsWithFilesAndDisplay(Dictionary<string, object> outputs,
		Dictionary<string, object> fileOutputs, List<object> displayData, bool includeDisplayData = true)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			// Get model units from active document
			var modelUnits = "Meters"; // Default
			var doc = RhinoDoc.ActiveDoc;
			if (doc != null) modelUnits = doc.ModelUnitSystem.ToString();

			var message = new
			{
				type = "outputs",
				sessionId = _sessionId,
				outputs,
				fileOutputs,
				displayData = includeDisplayData ? displayData : new List<object>(),
				modelUnits
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast current input values to all connected clients
	/// </summary>
	public async Task BroadcastCurrentValues(Dictionary<string, object> values)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "currentValues",
				sessionId = _sessionId,
				values
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast schema update to all connected clients
	/// </summary>
	public async Task BroadcastSchemaUpdate(UISchema schema, List<Guid> removedIds = null)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "schemaUpdated",
				sessionId = _sessionId,
				schema,
				removedIds = removedIds ?? new List<Guid>()
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast initial data to all connected clients (schema, available params, current values)
	/// </summary>
	public async Task BroadcastInitialData(UISchema schema, DiscoveredParameters availableParams,
		Dictionary<string, object> currentValues)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "initialData",
				sessionId = _sessionId,
				schema,
				availableParams,
				currentValues,
				isSolving = _lastBroadcastedSolvingState ?? false // Include current solving state
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast schema save confirmation to all connected clients
	/// </summary>
	public async Task BroadcastSchemaSaved(bool success, string message = null)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var msg = new
			{
				type = "schemaSaved",
				sessionId = _sessionId,
				success,
				message
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(msg));
		}
	}

	/// <summary>
	///   Broadcast solving state to all connected clients
	///   Deduplicates rapid state changes and respects cycle-based suppression
	/// </summary>
	public async Task BroadcastSolvingState(bool isSolving)
	{
		// Handle cycle-based suppression
		if (_suppressSolvingCyclesRemaining > 0)
		{
			// On SolutionEnd (isSolving=false), decrement the counter
			if (!isSolving)
			{
				_suppressSolvingCyclesRemaining--;
				Logger.Log($"[CommunicationHandler] Cycle suppressed ({_suppressSolvingCyclesRemaining} remaining)");
			}
			else
			{
				Logger.Log($"[CommunicationHandler] Skipping solving state (suppressed): {isSolving}");
			}
			return;
		}

		// Skip if this is the same state we just sent
		if (_lastBroadcastedSolvingState == isSolving)
		{
			Logger.Log($"[CommunicationHandler] Skipping duplicate solving state: {isSolving}");
			return;
		}

		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			_lastBroadcastedSolvingState = isSolving;
			var message = new
			{
				type = "solvingState",
				sessionId = _sessionId,
				isSolving
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast parameter metadata changes (nickname, min/max, stepsize, etc.)
	/// </summary>
	public async Task BroadcastMetadataChanges(DiscoveredParameters changedParams)
	{
		// Skip during schema save to avoid triggering a second save on the frontend
		if (_suppressSolvingCyclesRemaining > 0) return;

		if (_webSocketServer != null && _webSocketServer.IsRunning && changedParams != null &&
				(changedParams.Inputs?.Count > 0 || changedParams.Outputs?.Count >  0))
		{
			var message = new
			{
				type = "metadataUpdated",
				sessionId = _sessionId,
				changedParams
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast a runtime message to the web UI (for toasts, notifications, etc.)
	/// </summary>
	public async Task BroadcastRuntimeMessage(string level, string messageText)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "runtimeMessage",
				sessionId = _sessionId,
				level, // "error", "warning", "remark", "info"
				message = messageText,
				timestamp = DateTime.UtcNow
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast sync diff (showing what would change in each direction)
	/// </summary>
	public async Task BroadcastSyncPreview(SyncDiff syncDiff)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning && syncDiff != null)
		{
			var message = new
			{
				type = "syncPreview",
				sessionId = _sessionId,
				fromGH = syncDiff.FromGH,
				toGH = syncDiff.ToGH
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
		}
	}

	/// <summary>
	///   Broadcast sync completion status
	/// </summary>
	public async Task BroadcastSyncApplied(bool success, string message = null)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var msg = new
			{
				type = "syncApplied",
				sessionId = _sessionId,
				success,
				message = message ?? (success ? "Sync completed successfully" : "Sync failed")
			};
			await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(msg));
		}
	}

	protected virtual void Dispose(bool disposing)
	{
		if (_disposed) return;

		if (disposing) Stop();

		_disposed = true;
	}
}

// Message types for WebSocket communication
public class WebSocketMessage
{
	[JsonProperty("type")] public string Type { get; set; }

	[JsonProperty("sessionId")] public string SessionId { get; set; }
}

public class ValueUpdateMessage : WebSocketMessage
{
	[JsonProperty("values")] public Dictionary<string, object> Values { get; set; }
}

public class SchemaSaveMessage : WebSocketMessage
{
	[JsonProperty("schema")] public UISchema Schema { get; set; }
}
