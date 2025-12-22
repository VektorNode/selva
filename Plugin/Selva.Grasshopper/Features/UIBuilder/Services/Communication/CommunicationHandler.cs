using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino;
using Selva.Core.Models;
using Selva.Grasshopper.Config;
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
	private WebSocketServer _webSocketServer;

	public CommunicationHandler(string sessionId, int port = 8765)
	{
		_sessionId = sessionId;
		_port = port;
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

	/// <summary>
	///   Start WebSocket server
	/// </summary>
	public async Task StartAsync(Action<string> logMessage)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning) return;

		try
		{
			// Capture the current thread ID (main/UI thread where Start is called)
			_mainThreadId = Thread.CurrentThread.ManagedThreadId;

			_webSocketServer = new WebSocketServer(_port);
			_webSocketServer.OnClientConnected += (sender, webSocket) =>
			{
				logMessage?.Invoke("Web UI client connected");
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

						// Validate session ID first
						if (sessionId != _sessionId) return;

						// Create message processor task
						Func<Task> processTask = async () =>
						{
							if (msgType == "valueUpdate")
							{
								Logger.Log("[CommunicationHandler] Deserializing valueUpdate...");
								var values = jObj["values"]
									?.ToObject<Dictionary<string, object>>(JsonSerializer.Create(SecureJsonSettings));
								if (values != null)
								{
									Logger.Log($"[CommunicationHandler] Received valueUpdate with {values.Count} values");
									// Marshal back to main thread - critical for Grasshopper UI updates
									MarshalToMainThread(() => OnValuesReceived?.Invoke(this, values));
								}
								else
								{
									Logger.Warn("[CommunicationHandler] valueUpdate 'values' object was null");
								}
							}
							else if (msgType == "requestCurrentValues")
							{
								logMessage?.Invoke("Web UI requested current values");
								MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
							}
							else if (msgType == "requestInitialData")
							{
								logMessage?.Invoke("Web UI requested initial data");
								MarshalToMainThread(() => OnClientConnected?.Invoke(this, EventArgs.Empty));
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
			logMessage?.Invoke($"WebSocket server started on port {_webSocketServer.Port}");
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
	///   Broadcast output values and file data to all connected clients in a single message
	/// </summary>
	public async Task BroadcastOutputsWithFiles(Dictionary<string, object> outputs,
		Dictionary<string, object> fileOutputs)
	{
		if (_webSocketServer != null && _webSocketServer.IsRunning)
		{
			var message = new
			{
				type = "outputs",
				sessionId = _sessionId,
				outputs,
				fileOutputs
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

	protected virtual void Dispose(bool disposing)
	{
		if (_disposed) return;

		if (disposing)
		{
			Stop();

			// Dispose all message type locks
			lock (_queueLock)
			{
				foreach (var kvp in _messageTypeLocks)
				{
					kvp.Value?.Dispose();
				}
				_messageTypeLocks.Clear();
				_messageTypeQueues.Clear();
			}
		}

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
