using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Rhino;
using Selva.Config;
using Selva.Features.UIBuilder.Models;

namespace Selva.Features.UIBuilder.Services;

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

  private readonly int _port;
  private readonly string _sessionId;
  private bool _disposed;
  private int _mainThreadId;
  private WebSocketServer _webSocketServer;

  public CommunicationHandler(string sessionId, int port = 8765)
  {
    _sessionId = sessionId;
    _port = port;
  }

  public bool IsRunning => _webSocketServer?.IsRunning ?? false;

  public void Dispose()
  {
    Dispose(true);
    GC.SuppressFinalize(this);
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

      // Handle incoming messages asynchronously to avoid blocking UI thread
      _webSocketServer.OnMessageReceived += (sender, message) =>
      {
        // Process message on background thread to avoid blocking WebSocket thread
        _ = Task.Run(() =>
        {
          try
          {
            var msg = JsonConvert.DeserializeObject<WebSocketMessage>(message, SecureJsonSettings);

            if (msg.Type == "valueUpdate")
            {
              var valueMsg = JsonConvert.DeserializeObject<ValueUpdateMessage>(message, SecureJsonSettings);
              if (valueMsg != null && valueMsg.SessionId == _sessionId)
                // Marshal back to main thread - critical for Grasshopper UI updates
                MarshalToMainThread(() => OnValuesReceived?.Invoke(this, valueMsg.Values));
            }
            else if (msg.Type == "requestCurrentValues")
            {
              if (msg.SessionId == _sessionId)
              {
                logMessage?.Invoke("Web UI requested current values");
                MarshalToMainThread(() => OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty));
              }
            }
            else if (msg.Type == "requestInitialData")
            {
              if (msg.SessionId == _sessionId)
              {
                logMessage?.Invoke("Web UI requested initial data");
                MarshalToMainThread(() => OnClientConnected?.Invoke(this, EventArgs.Empty));
              }
            }
            else if (msg.Type == "saveSchema")
            {
              var schemaMsg = JsonConvert.DeserializeObject<SchemaSaveMessage>(message, SecureJsonSettings);
              if (schemaMsg != null && schemaMsg.SessionId == _sessionId)
              {
                logMessage?.Invoke("Web UI saving schema");
                MarshalToMainThread(() => OnSchemaSaveRequested?.Invoke(this, schemaMsg.Schema));
              }
            }
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
      logMessage?.Invoke($"WebSocket Port: {_port}");
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
        Debug.WriteLine($"Error stopping WebSocket: {ex.Message}");
      }
      finally
      {
        _webSocketServer = null;
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
    catch (Exception ex)
    {
      // If marshaling fails, execute directly (may cause issues but better than deadlock)
      Debug.WriteLine($"Failed to marshal to UI thread: {ex.Message}");
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
  ///   Broadcast initial data to all connected clients (schema, available params, available outputs, current values)
  /// </summary>
  public async Task BroadcastInitialData(UISchema schema, AvailableParameters availableParams,
    List<AvailableOutput> availableOutputs, Dictionary<string, object> currentValues)
  {
    if (_webSocketServer != null && _webSocketServer.IsRunning)
    {
      var message = new
      {
        type = "initialData",
        sessionId = _sessionId,
        schema,
        availableParams,
        availableOutputs,
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
  /// </summary>
  public async Task BroadcastSolvingState(bool isSolving)
  {
    if (_webSocketServer != null && _webSocketServer.IsRunning)
    {
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
  public async Task BroadcastMetadataChanges(List<AvailableParameter> changedParams)
  {
    if (_webSocketServer != null && _webSocketServer.IsRunning && changedParams?.Count > 0)
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
