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
        public event EventHandler<string> OnClientConnected;
        public event EventHandler OnCurrentValuesRequested;

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
                    }
                    catch (Exception ex)
                    {
                        logMessage?.Invoke($"WebSocket message error: {ex.Message}");
                    }
                };

                // Handle client connections
                _webSocketServer.OnClientConnected += (sender, client) =>
                {
                    OnClientConnected?.Invoke(this, client);
                    logMessage?.Invoke("Web UI connected via WebSocket");
                };

                _webSocketServer.StartAsync().Wait();
                logMessage?.Invoke($"WebSocket server started on port {_port}");
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
}
