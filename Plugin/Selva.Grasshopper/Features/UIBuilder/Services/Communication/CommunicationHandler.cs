using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino;
using Selva.Core.Models;
using Selva.Grasshopper.Config;
using Selva.Grasshopper.Features.UIBuilder.Services.Schema;
using Selva.Grasshopper.Utilities.Helpers;

namespace Selva.Grasshopper.Features.UIBuilder.Services.Communication;

/// <summary>
///   Handles WebSocket communication with the web UI
/// </summary>
public class CommunicationHandler : IDisposable
{
	/// <summary>
	///   Secure JSON serializer settings - prevents type confusion attacks
	/// </summary>
	private static readonly JsonSerializerSettings SecureJsonSettings = new()
	{
		TypeNameHandling = TypeNameHandling.None,
		MaxDepth = AppConfig.JsonSerialization.MaxJsonDepth,
		MetadataPropertyHandling = MetadataPropertyHandling.Ignore
	};

	// Message processing queues for parallel processing with ordering guarantees
	private readonly Dictionary<string, Queue<Func<Task>>> _messageTypeQueues = new();
	private readonly Dictionary<string, SemaphoreSlim> _messageTypeLocks = new();
	private readonly object _queueLock = new();

	private readonly int _port;
	private readonly string _sessionId;
	private bool _disposed;
	private bool? _lastBroadcastedSolvingState; // Track last state to prevent duplicates
	private int _mainThreadId;
	private CancellationTokenSource _suppressionCts; // Cancellation for suppression delay
	private bool _suppressSolvingStateUpdates; // Suppress during schema operations
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
	///   Temporarily suppress solving state updates (used during schema saves)
	///   Uses cancellation to prevent overlapping suppression periods
	/// </summary>
	public void SetSuppressSolvingStateUpdates(bool suppress, int durationMs = 0)
	{
		// Cancel any previous suppression delay
		_suppressionCts?.Cancel();
		_suppressionCts?.Dispose();
		_suppressionCts = null;

		_suppressSolvingStateUpdates = suppress;
		Logger.Log($"[CommunicationHandler] Solving state updates {(suppress ? "SUPPRESSED" : "ENABLED")}");

		// If suppressing with a duration, auto-unsuppress after delay
		if (suppress && durationMs > 0)
		{
			_suppressionCts = new CancellationTokenSource();
			var cts = _suppressionCts; // Capture for closure

			Task.Run(async () =>
			{
				try
				{
					await Task.Delay(durationMs, cts.Token);
					if (!cts.Token.IsCancellationRequested)
					{
						_suppressSolvingStateUpdates = false;
						Logger.Log("[CommunicationHandler] Solving state updates ENABLED (auto)");
					}
				}
				catch (TaskCanceledException)
				{
					// Expected when a new suppression cancels the old one
				}
			});
		}
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

			// Handle incoming messages with parallel processing but per-type ordering
			_webSocketServer.OnMessageReceived += (sender, message) =>
			{
				_ = Task.Run(async () =>
				{
					try
					{
						Logger.Log($"[CommunicationHandler] Received message, length: {message.Length} bytes");

						// Parse JSON once using JObject
						var jObj = JObject.Parse(message);
						var msgType = jObj["type"]?.ToString();
						var sessionId = jObj["sessionId"]?.ToString();

						Logger.Log($"[CommunicationHandler] Message type: {msgType}, SessionId match: {sessionId == _sessionId}");

						// Validate session ID first (except for requestInitialData which establishes the session)
						if (msgType != "requestInitialData" && sessionId != _sessionId)
						{
							Logger.Warn($"[CommunicationHandler] Session ID mismatch. Expected: {_sessionId}, Received: {sessionId}");
							return;
						}

						// Create message processor task
						Func<Task> processTask = async () =>
						{
							if (msgType == "valueUpdate")
							{
								var values = jObj["values"]
									?.ToObject<Dictionary<string, object>>(JsonSerializer.Create(SecureJsonSettings));

								if (values != null)
								{
									// Marshal back to main thread - critical for Grasshopper UI updates
									MarshalToMainThread(() => OnValuesReceived?.Invoke(this, values));
								}
								else
								{
									Logger.Warn("[CommunicationHandler] valueUpdate 'values' object was null");
									logMessage?.Invoke("Error: valueUpdate 'values' object was null");
								}
							}
							else if (msgType == "requestCurrentValues")
							{
#if DEBUG
								logMessage?.Invoke("Web UI requested current values");
#endif
								MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
							}
							else if (msgType == "requestInitialData")
							{
								// Deduplicate: if a handler is already in-flight (e.g. rapid reconnects), skip
								if (Interlocked.CompareExchange(ref _initialDataInFlight, 1, 0) != 0) return;
#if DEBUG
								logMessage?.Invoke("Web UI requested initial data");
#endif
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
									// Marshal failed — release immediately so future requests aren't blocked
									Interlocked.Exchange(ref _initialDataInFlight, 0);
								}
							}
							else if (msgType == "saveSchema")
							{
								var schema = jObj["schema"]?.ToObject<UISchema>(JsonSerializer.Create(SecureJsonSettings));
								if (schema != null)
								{
									logMessage?.Invoke("Web UI saving schema");
									MarshalToMainThread(() => OnSchemaSaveRequested?.Invoke(this, schema));
								}
							}
							else if (msgType == "requestSyncPreview")
							{
								var schema = jObj["schema"]?.ToObject<UISchema>(JsonSerializer.Create(SecureJsonSettings));
								if (schema != null)
								{
									logMessage?.Invoke("Web UI requested sync preview");
									MarshalToMainThread(() => OnSyncPreviewRequested?.Invoke(this, schema));
								}
							}
							else if (msgType == "applySyncChanges")
							{
								var changes = jObj["changes"]?.ToObject<List<SyncChange>>(JsonSerializer.Create(SecureJsonSettings));
								if (changes != null)
								{
									logMessage?.Invoke($"Web UI applying {changes.Count} sync changes");
									MarshalToMainThread(() => OnSyncChangesApply?.Invoke(this, changes));
								}
							}
						};

						// Enqueue and process with ordering guarantees per message type
						await EnqueueMessageProcessing(msgType, processTask);
					}
					catch (Exception ex)
					{
						logMessage?.Invoke($"WebSocket message error: {ex.Message}");
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
		// Cancel any pending suppression delays
		_suppressionCts?.Cancel();
		_suppressionCts?.Dispose();
		_suppressionCts = null;

		// Clear per-type queues and semaphores so they don't accumulate across sessions
		lock (_queueLock)
		{
			foreach (var kvp in _messageTypeLocks) kvp.Value?.Dispose();
			_messageTypeLocks.Clear();
			_messageTypeQueues.Clear();
		}

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
				Interlocked.Exchange(ref _initialDataInFlight, 0); // Reset for next session
			}
	}

	/// <summary>
	///   Enqueue message processing with ordering guarantees per message type.
	///   Different message types can process in parallel, but messages of the same type are processed in order.
	/// </summary>
	private async Task EnqueueMessageProcessing(string messageType, Func<Task> processTask)
	{
		if (string.IsNullOrEmpty(messageType)) return;

		SemaphoreSlim typeLock;
		Queue<Func<Task>> queue;

		// Get or create queue and lock for this message type
		lock (_queueLock)
		{
			if (!_messageTypeQueues.ContainsKey(messageType))
			{
				_messageTypeQueues[messageType] = new Queue<Func<Task>>();
				_messageTypeLocks[messageType] = new SemaphoreSlim(1, 1);
			}

			queue = _messageTypeQueues[messageType];
			typeLock = _messageTypeLocks[messageType];
			queue.Enqueue(processTask);
		}

		// Process queue for this message type (ensures ordering)
		await typeLock.WaitAsync();
		try
		{
			Func<Task> task;
			lock (_queueLock)
			{
				if (queue.Count == 0) return;
				task = queue.Dequeue();
			}

			await task();
		}
		finally
		{
			typeLock.Release();
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
		// If we're already on the main thread, execute directly
		if (Thread.CurrentThread.ManagedThreadId == _mainThreadId)
		{
			callback?.Invoke();
			return;
		}

		// Use RhinoApp.InvokeOnUiThread for thread-safe execution on main thread
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
	///   Broadcast output values to all connected clients
	/// </summary>
	public async Task BroadcastOutputs(Dictionary<string, object> outputs)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "outputs",
				sessionId = _sessionId,
				outputs
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
				currentValues
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
	///   Deduplicates rapid state changes and respects suppression flag
	/// </summary>
	public async Task BroadcastSolvingState(bool isSolving)
	{
		// Skip if updates are suppressed (e.g., during schema save)
		if (_suppressSolvingStateUpdates)
		{
			Logger.Log($"[CommunicationHandler] Skipping solving state (suppressed): {isSolving}");
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
		// Skip during schema save window to avoid triggering a second save on the frontend
		if (_suppressSolvingStateUpdates) return;

		if (_webSocketServer != null && _webSocketServer.IsRunning && changedParams != null &&
				(changedParams.Inputs?.Count > 0 || changedParams.Outputs?.Count > 0))
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
