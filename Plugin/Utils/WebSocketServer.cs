using System;
using System.Collections.Generic;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ComputeBuilder.Plugin.Utils
{
    /// <summary>
    ///     Simple WebSocket server for real-time communication with the web UI
    ///     Only used for local interactive mode
    /// </summary>
    public class WebSocketServer : IDisposable
    {
        private readonly object _clientsLock = new object();
        private readonly List<WebSocket> _connectedClients = new List<WebSocket>();
        private CancellationTokenSource _cancellationTokenSource;
        private HttpListener _httpListener;

        public WebSocketServer(int port = 8765)
        {
            Port = port;
        }

        public bool IsRunning { get; private set; }

        public int Port { get; }

        public void Dispose()
        {
            Stop();
            _cancellationTokenSource?.Dispose();
        }

        public event EventHandler<string> OnMessageReceived;
        public event EventHandler<WebSocket> OnClientConnected;

        /// <summary>
        ///     Start the WebSocket server
        /// </summary>
        public Task StartAsync()
        {
            if (IsRunning)
            {
                return Task.CompletedTask;
            }

            _cancellationTokenSource = new CancellationTokenSource();
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://localhost:{Port}/");

            try
            {
                _httpListener.Start();
                IsRunning = true;

                // Start accepting connections in background
                _ = Task.Run(async () => await AcceptConnectionsAsync(_cancellationTokenSource.Token));

                return Task.CompletedTask;
            }
            catch (Exception ex)
            {
                throw new Exception($"Failed to start WebSocket server: {ex.Message}", ex);
            }
        }

        /// <summary>
        ///     Stop the WebSocket server
        /// </summary>
        public void Stop()
        {
            if (!IsRunning)
            {
                return;
            }

            _cancellationTokenSource?.Cancel();

            lock (_clientsLock)
            {
                foreach (var client in _connectedClients)
                {
                    try
                    {
                        client?.CloseAsync(WebSocketCloseStatus.NormalClosure, "Server shutting down",
                            CancellationToken.None).Wait(1000);
                        client?.Dispose();
                    }
                    catch
                    {
                    }
                }

                _connectedClients.Clear();
            }

            _httpListener?.Stop();
            _httpListener?.Close();
            IsRunning = false;
        }

        /// <summary>
        ///     Send a message to all connected clients
        /// </summary>
        public async Task BroadcastAsync(string message)
        {
            if (!IsRunning)
            {
                return;
            }

            var buffer = Encoding.UTF8.GetBytes(message);
            var segment = new ArraySegment<byte>(buffer);

            List<WebSocket> clientsCopy;
            lock (_clientsLock)
            {
                clientsCopy = new List<WebSocket>(_connectedClients);
            }

            var clientsToRemove = new List<WebSocket>();

            // Send to all clients without holding lock
            foreach (var client in clientsCopy)
            {
                if (client.State == WebSocketState.Open)
                {
                    try
                    {
                        // Use await instead of Wait() to avoid blocking
                        await client.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
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

            // Remove dead clients
            if (clientsToRemove.Count > 0)
            {
                lock (_clientsLock)
                {
                    foreach (var client in clientsToRemove)
                    {
                        _connectedClients.Remove(client);
                        try
                        {
                            client.Dispose();
                        }
                        catch
                        {
                        }
                    }
                }
            }
        }

        private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested && IsRunning)
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
                    break;
                }
                catch (Exception)
                {
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

                // Notify that a new client connected
                OnClientConnected?.Invoke(this, webSocket);

                await ReceiveMessagesAsync(webSocket, cancellationToken);
            }
            catch (Exception)
            {
            }
            finally
            {
                if (webSocket != null)
                {
                    lock (_clientsLock)
                    {
                        _connectedClients.Remove(webSocket);
                    }

                    try
                    {
                        if (webSocket.State == WebSocketState.Open)
                        {
                            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Connection closed",
                                CancellationToken.None);
                        }

                        webSocket.Dispose();
                    }
                    catch
                    {
                    }
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
                        await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing",
                            CancellationToken.None);
                        break;
                    }

                    if (result.MessageType == WebSocketMessageType.Text)
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
    }
}