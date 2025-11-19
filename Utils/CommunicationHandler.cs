using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json;
using ComputeBuilder.Models;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Handles WebSocket communication with the web UI
    /// </summary>
    public class CommunicationHandler : IDisposable
    {
        private WebSocketServer _webSocketServer;
        private readonly int _port;
        private readonly string _sessionId;
        private bool _disposed = false;

        public event EventHandler<Dictionary<string, object>> OnValuesReceived;
        public event EventHandler OnCurrentValuesRequested;
        public event EventHandler OnClientConnected;
        public event EventHandler<UISchema> OnSchemaSaveRequested;

        public bool IsRunning => _webSocketServer?.IsRunning ?? false;

        public CommunicationHandler(string sessionId, int port = 8765)
        {
            _sessionId = sessionId;
            _port = port;
        }

        /// <summary>
        /// Start WebSocket server
        /// </summary>
        public void Start(Action<string> logMessage)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
                return;

            try
            {
                _webSocketServer = new WebSocketServer(_port);

                // Handle client connections
                _webSocketServer.OnClientConnected += (sender, webSocket) =>
                {
                    logMessage?.Invoke("Web UI client connected");
                    // Don't invoke OnClientConnected here - wait for explicit requestInitialData message
                    // This prevents duplicate initial data being sent
                };

                // Handle incoming messages
                _webSocketServer.OnMessageReceived += (sender, message) =>
                {
                    try
                    {
                        var msg = JsonConvert.DeserializeObject<WebSocketMessage>(message);

                        if (msg.Type == "valueUpdate")
                        {
                            var valueMsg = JsonConvert.DeserializeObject<ValueUpdateMessage>(message);
                            if (valueMsg != null && valueMsg.SessionId == _sessionId)
                            {
                                OnValuesReceived?.Invoke(this, valueMsg.Values);
                            }
                        }
                        else if (msg.Type == "requestCurrentValues")
                        {
                            if (msg.SessionId == _sessionId)
                            {
                                logMessage?.Invoke("Web UI requested current values");
                                OnCurrentValuesRequested?.Invoke(this, EventArgs.Empty);
                            }
                        }
                        else if (msg.Type == "requestInitialData")
                        {
                            if (msg.SessionId == _sessionId)
                            {
                                logMessage?.Invoke("Web UI requested initial data");
                                OnClientConnected?.Invoke(this, EventArgs.Empty);
                            }
                        }
                        else if (msg.Type == "saveSchema")
                        {
                            var schemaMsg = JsonConvert.DeserializeObject<SchemaSaveMessage>(message);
                            if (schemaMsg != null && schemaMsg.SessionId == _sessionId)
                            {
                                logMessage?.Invoke("Web UI saving schema");
                                OnSchemaSaveRequested?.Invoke(this, schemaMsg.Schema);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        logMessage?.Invoke($"WebSocket message error: {ex.Message}");
                    }
                };

                _webSocketServer.StartAsync().Wait();
                logMessage?.Invoke($"WebSocket Port: {_port}");
            }
            catch (Exception ex)
            {
                logMessage?.Invoke($"Could not start WebSocket server: {ex.Message}");
                throw;
            }
        }

        /// <summary>
        /// Stop WebSocket server
        /// </summary>
        public void Stop()
        {
            if (_webSocketServer != null)
            {
                try
                {
                    _webSocketServer.Stop();
                    _webSocketServer.Dispose();
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error stopping WebSocket: {ex.Message}");
                }
                finally
                {
                    _webSocketServer = null;
                }
            }
        }

        /// <summary>
        /// Broadcast output values to all connected clients
        /// </summary>
        public async Task BroadcastOutputs(Dictionary<string, object> outputs)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
            {
                var message = new
                {
                    type = "outputs",
                    sessionId = _sessionId,
                    outputs = outputs
                };
                await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
            }
        }

        /// <summary>
        /// Broadcast current input values to all connected clients
        /// </summary>
        public async Task BroadcastCurrentValues(Dictionary<string, object> values)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
            {
                var message = new
                {
                    type = "currentValues",
                    sessionId = _sessionId,
                    values = values
                };
                await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
            }
        }

        /// <summary>
        /// Broadcast schema update to all connected clients
        /// </summary>
        public async Task BroadcastSchemaUpdate(UISchema schema, List<Guid> removedIds = null)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
            {
                var message = new
                {
                    type = "schemaUpdated",
                    sessionId = _sessionId,
                    schema = schema,
                    removedIds = removedIds ?? new List<Guid>()
                };
                await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
            }
        }

        /// <summary>
        /// Broadcast initial data to all connected clients (schema, available params, current values)
        /// </summary>
        public async Task BroadcastInitialData(UISchema schema, AvailableParameters availableParams, Dictionary<string, object> currentValues)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
            {
                var message = new
                {
                    type = "initialData",
                    sessionId = _sessionId,
                    schema = schema,
                    availableParams = availableParams,
                    currentValues = currentValues
                };
                await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(message));
            }
        }

        /// <summary>
        /// Broadcast schema save confirmation to all connected clients
        /// </summary>
        public async Task BroadcastSchemaSaved(bool success, string message = null)
        {
            if (_webSocketServer != null && _webSocketServer.IsRunning)
            {
                var msg = new
                {
                    type = "schemaSaved",
                    sessionId = _sessionId,
                    success = success,
                    message = message
                };
                await _webSocketServer.BroadcastAsync(JsonConvert.SerializeObject(msg));
            }
        }

        public void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        protected virtual void Dispose(bool disposing)
        {
            if (_disposed)
                return;

            if (disposing)
            {
                Stop();
            }

            _disposed = true;
        }
    }

    // Message types for WebSocket communication
    public class WebSocketMessage
    {
        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("sessionId")]
        public string SessionId { get; set; }
    }

    public class ValueUpdateMessage : WebSocketMessage
    {
        [JsonProperty("values")]
        public Dictionary<string, object> Values { get; set; }
    }

    public class SchemaSaveMessage : WebSocketMessage
    {
        [JsonProperty("schema")]
        public UISchema Schema { get; set; }
    }
}
