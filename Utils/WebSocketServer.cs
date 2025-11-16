using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace ComputeBuilder.Utils
{
    /// <summary>
    /// Simple WebSocket server for real-time communication with the web UI
    /// Only used for local interactive mode
    /// </summary>
    public class WebSocketServer : IDisposable
    {
        private HttpListener _httpListener;
        private readonly List<WebSocket> _connectedClients = new List<WebSocket>();
        private CancellationTokenSource _cancellationTokenSource;
        private readonly int _port;
        private bool _isRunning;
        private readonly object _clientsLock = new object();

        public event EventHandler<string> OnMessageReceived;
        public event EventHandler<string> OnClientConnected;
        public event EventHandler<string> OnClientDisconnected;

        public bool IsRunning => _isRunning;
        public int Port => _port;

        public WebSocketServer(int port = 8765)
        {
            _port = port;
        }

        /// <summary>
        /// Start the WebSocket server
        /// </summary>
        public async Task StartAsync()
        {
            if (_isRunning)
                return;

            _cancellationTokenSource = new CancellationTokenSource();
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://localhost:{_port}/");

            try
            {
                _httpListener.Start();
                _isRunning = true;

                // Start accepting connections
                _ = Task.Run(async () => await AcceptConnectionsAsync(_cancellationTokenSource.Token));
            }
            catch (Exception ex)
            {
                throw new Exception($"Failed to start WebSocket server: {ex.Message}", ex);
            }
        }

        /// <summary>
        /// Stop the WebSocket server
        /// </summary>
        public void Stop()
        {
            if (!_isRunning)
                return;

            _cancellationTokenSource?.Cancel();

            lock (_clientsLock)
            {
                foreach (var client in _connectedClients)
                {
                    try
                    {
                        client?.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server shutting down", CancellationToken.None).Wait(1000);
                        client?.Dispose();
                    }
                    catch { }
                }
                _connectedClients.Clear();
            }

            _httpListener?.Stop();
            _httpListener?.Close();
            _isRunning = false;
        }

        /// <summary>
        /// Send a message to all connected clients
        /// </summary>
        public async Task BroadcastAsync(string message)
        {
            if (!_isRunning)
                return;

            var buffer = Encoding.UTF8.GetBytes(message);
            var segment = new ArraySegment<byte>(buffer);

            List<WebSocket> clientsToRemove = new List<WebSocket>();

            lock (_clientsLock)
            {
                foreach (var client in _connectedClients)
                {
                    if (client.State == WebSocketState.Open)
                    {
                        try
                        {
                            client.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None).Wait();
                        }
                        catch
                        {
                            clientsToRemove.Add(client);
                        }
                    }
                    else
                    {
                        clientsToRemove.Add(client);
                    }
                }

                foreach (var client in clientsToRemove)
                {
                    _connectedClients.Remove(client);
                    try { client.Dispose(); } catch { }
                }
            }
        }

        private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested && _isRunning)
            {
                try
                {
                    var context = await _httpListener.GetContextAsync();

                    if (context.Request.IsWebSocketRequest)
                    {
                        ProcessWebSocketRequest(context, cancellationToken);
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                        context.Response.Close();
                    }
                }
                catch (HttpListenerException)
                {
                    // Listener was stopped
                    break;
                }
                catch (Exception)
                {
                    // Continue accepting connections
                }
            }
        }

        private async void ProcessWebSocketRequest(HttpListenerContext context, CancellationToken cancellationToken)
        {
            WebSocket webSocket = null;

            try
            {
                var webSocketContext = await context.AcceptWebSocketAsync(null);
                webSocket = webSocketContext.WebSocket;

                lock (_clientsLock)
                {
                    _connectedClients.Add(webSocket);
                }

                OnClientConnected?.Invoke(this, context.Request.RemoteEndPoint?.ToString() ?? "unknown");

                await ReceiveMessagesAsync(webSocket, cancellationToken);
            }
            catch (Exception)
            {
                // Connection failed
            }
            finally
            {
                if (webSocket != null)
                {
                    lock (_clientsLock)
                    {
                        _connectedClients.Remove(webSocket);
                    }

                    OnClientDisconnected?.Invoke(this, "client");

                    try
                    {
                        if (webSocket.State == WebSocketState.Open)
                        {
                            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connection closed", CancellationToken.None);
                        }
                        webSocket.Dispose();
                    }
                    catch { }
                }
            }
        }

        private async Task ReceiveMessagesAsync(WebSocket webSocket, CancellationToken cancellationToken)
        {
            var buffer = new byte[4096];

            while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                        break;
                    }
                    else if (result.MessageType == WebSocketMessageType.Text)
                    {
                        var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                        OnMessageReceived?.Invoke(this, message);
                    }
                }
                catch (WebSocketException)
                {
                    break;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        public void Dispose()
        {
            Stop();
            _cancellationTokenSource?.Dispose();
        }
    }

    /// <summary>
    /// WebSocket message types
    /// </summary>
    public class WebSocketMessage
    {
        [JsonProperty("type")]
        public string Type { get; set; }

        [JsonProperty("data")]
        public object Data { get; set; }
    }

    public class ValueUpdateMessage
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "valueUpdate";

        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("values")]
        public Dictionary<string, object> Values { get; set; }
    }

    public class OutputUpdateMessage
    {
        [JsonProperty("type")]
        public string Type { get; set; } = "outputUpdate";

        [JsonProperty("sessionId")]
        public string SessionId { get; set; }

        [JsonProperty("outputs")]
        public Dictionary<string, object> Outputs { get; set; }
    }
}
