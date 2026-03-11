using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Config;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Simple WebSocket server for real-time communication with the web UI.
///     Only used for local interactive mode.
/// </summary>
public class WebSocketServer : IDisposable
{
    private const int MAX_MESSAGE_SIZE = AppConfig.WebSocket.MaxMessageSizeBytes;
    private const int BUFFER_SIZE = AppConfig.WebSocket.BufferSizeBytes;
    private const int MAX_CLIENTS = AppConfig.WebSocket.MaxConcurrentClients;
    private const int HEARTBEAT_INTERVAL = AppConfig.WebSocket.HeartbeatIntervalMs;
    private const int BROADCAST_TIMEOUT = AppConfig.WebSocket.BroadcastTimeoutMs;
    private const int MAX_SEND_QUEUE = 10;
    private readonly Dictionary<WebSocket, int> _clientPendingMessages = new();

    private readonly object _clientsLock = new();
    private readonly List<WebSocket> _connectedClients = new();

    private CancellationTokenSource _cancellationTokenSource;
    private bool _disposed;
    private Timer _heartbeatTimer;
    private HttpListener _httpListener;

    public WebSocketServer(int port = AppConfig.WebSocket.DefaultPort)
    {
        Port = port;
    }

    public bool IsRunning { get; private set; }
    public int Port { get; private set; }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        Stop();
        _heartbeatTimer?.Dispose();
        _cancellationTokenSource?.Dispose();
        GC.SuppressFinalize(this);
    }

    public event EventHandler<string> OnMessageReceived;
    public event EventHandler<WebSocket> OnClientConnected;

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Start the WebSocket server. Tries the preferred port first; if it's already in
    ///     use, falls back to a random free port automatically.
    /// </summary>
    public Task StartAsync()
    {
        if (IsRunning) return Task.CompletedTask;

        _cancellationTokenSource = new CancellationTokenSource();

        // Try the preferred port, then fall back to a free one if it's taken.
        if (!TryBindHttpListener(Port == 0 ? FindAvailablePort() : Port, out var boundPort))
        {
            var fallback = FindAvailablePort();
            if (!TryBindHttpListener(fallback, out boundPort))
            {
                _httpListener = null;
                throw new InvalidOperationException(
                    $"Failed to start WebSocket server: preferred port {Port} and fallback port {fallback} are both unavailable.");
            }

            Logger.Warn($"WebSocket port {Port} was in use — using port {fallback} instead.");
        }

        Port = boundPort;
        IsRunning = true;
#if DEBUG
        Logger.Log($"WebSocket server started on port {Port}");
#endif

        _ = Task.Run(
            () => AcceptConnectionsAsync(_cancellationTokenSource.Token),
            _cancellationTokenSource.Token);

        StartHeartbeat();
        return Task.CompletedTask;
    }

    /// <summary>
    ///     Attempts to bind an HttpListener to the given port.
    ///     Returns true and sets <paramref name="boundPort" /> on success; returns false on failure.
    /// </summary>
    private bool TryBindHttpListener(int port, out int boundPort)
    {
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{port}/");
        try
        {
            listener.Start();
            _httpListener = listener;
            boundPort = port;
            return true;
        }
        catch
        {
            try
            {
                listener.Close();
            }
            catch
            {
            }

            boundPort = 0;
            return false;
        }
    }

    /// <summary>
    ///     Stop the WebSocket server and close all client connections.
    /// </summary>
    public void Stop()
    {
        // Lock for the whole Stop() so BroadcastAsync cannot interleave.
        lock (_clientsLock)
        {
            if (!IsRunning) return;
            IsRunning = false;
        }

        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;

        _cancellationTokenSource?.Cancel();

        lock (_clientsLock)
        {
            foreach (var client in _connectedClients)
                try
                {
                    client.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Server shutting down",
                            CancellationToken.None)
                        .Wait(AppConfig.WebSocket.ClientCloseTimeoutMs);

                    client.Dispose();
                }
                catch (Exception ex)
                {
                    Logger.Warn($"Error closing WebSocket client: {ex.Message}");
                }

            _connectedClients.Clear();
            _clientPendingMessages.Clear();
        }

        try
        {
            _httpListener?.Stop();
            _httpListener?.Close();
        }
        catch (Exception ex)
        {
            Logger.Error($"Error stopping HTTP listener: {ex.Message}");
        }
        finally
        {
            _httpListener = null;
        }
    }

    ~WebSocketServer()
    {
        Dispose();
    }

    // -------------------------------------------------------------------------
    // Broadcast
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Send a message to all connected clients with backpressure handling.
    /// </summary>
    public async Task BroadcastAsync(string message)
    {
        if (!IsRunning) return;

        var buffer = Encoding.UTF8.GetBytes(message);
        var segment = new ArraySegment<byte>(buffer);

        List<WebSocket> snapshot;
        lock (_clientsLock)
        {
            snapshot = new List<WebSocket>(_connectedClients);
        }

        var tasks = new List<Task>(snapshot.Count);
        var clientsToRemove = new List<WebSocket>();

        foreach (var client in snapshot)
        {
            if (client.State != WebSocketState.Open)
            {
                clientsToRemove.Add(client);
                continue;
            }

            // Single lock acquisition for the backpressure check + increment.
            lock (_clientsLock)
            {
                _clientPendingMessages.TryGetValue(client, out var pending);
                if (pending >= MAX_SEND_QUEUE)
                {
                    Logger.Warn($"Client send queue full ({pending} pending), dropping message.");
                    continue;
                }

                _clientPendingMessages[client] = pending + 1;
            }

            tasks.Add(SendToClientAsync(client, segment, clientsToRemove));
        }

        if (tasks.Count > 0)
            await Task.WhenAll(tasks).ConfigureAwait(false);

        RemoveDeadClients(clientsToRemove);
    }

    /// <summary>
    ///     Send to a single client. Returns false if the send failed.
    /// </summary>
    private async Task SendToClientAsync(
        WebSocket client,
        ArraySegment<byte> segment,
        List<WebSocket> clientsToRemove)
    {
        try
        {
            using var cts = new CancellationTokenSource(BROADCAST_TIMEOUT);
            await client.SendAsync(segment, WebSocketMessageType.Text, true, cts.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            Logger.Warn("Broadcast timeout — removing slow client.");
            MarkForRemoval(client, clientsToRemove);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Broadcast failed: {ex.Message}");
            MarkForRemoval(client, clientsToRemove);
        }
        finally
        {
            lock (_clientsLock)
            {
                if (_clientPendingMessages.TryGetValue(client, out var count))
                    _clientPendingMessages[client] = Math.Max(0, count - 1);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Connection handling
    // -------------------------------------------------------------------------

    private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && IsRunning)
            try
            {
                var context = await _httpListener.GetContextAsync().ConfigureAwait(false);

                if (context.Request.IsWebSocketRequest)
                {
                    // Fire-and-forget, but as a Task — NOT async void.
                    _ = Task.Run(
                        () => ProcessWebSocketRequestAsync(context, cancellationToken),
                        cancellationToken);
                }
                else
                {
                    context.Response.StatusCode = 400;
                    context.Response.Close();
                }
            }
            catch (HttpListenerException ex)
            {
                Logger.Warn($"WebSocket listener stopped: {ex.Message}");
                break;
            }
            catch (Exception ex)
            {
                Logger.Error($"Error accepting WebSocket connection: {ex.Message}");
            }
    }

    /// <summary>
    ///     Upgraded from async void — exceptions are now observable via the Task.
    /// </summary>
    private async Task ProcessWebSocketRequestAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken)
    {
        WebSocket webSocket = null;

        try
        {
            var wsContext = await context.AcceptWebSocketAsync(null).ConfigureAwait(false);
            webSocket = wsContext.WebSocket;

            lock (_clientsLock)
            {
                if (_connectedClients.Count >= MAX_CLIENTS)
                    // Reject outside the lock to avoid holding it during async work.
                    goto reject;

                _connectedClients.Add(webSocket);
                _clientPendingMessages[webSocket] = 0;
                goto accepted;
            }

            reject:
            await webSocket.CloseAsync(
                WebSocketCloseStatus.PolicyViolation,
                "Maximum client connections reached",
                CancellationToken.None).ConfigureAwait(false);
            webSocket.Dispose();
            return;

            accepted:
            OnClientConnected?.Invoke(this, webSocket);
            await ReceiveMessagesAsync(webSocket, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Error($"WebSocket request processing error: {ex.Message}");
        }
        finally
        {
            if (webSocket != null)
            {
                lock (_clientsLock)
                {
                    _connectedClients.Remove(webSocket);
                    _clientPendingMessages.Remove(webSocket);
                }

                try
                {
                    if (webSocket.State == WebSocketState.Open)
                        await webSocket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Connection closed",
                            CancellationToken.None).ConfigureAwait(false);

                    webSocket.Dispose();
                }
                catch (Exception ex)
                {
                    Logger.Warn($"Error closing WebSocket: {ex.Message}");
                }
            }
        }
    }

    private async Task ReceiveMessagesAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        var buffer = new byte[BUFFER_SIZE];

        // MemoryStream avoids the per-chunk List<byte> + AddRange allocations.
        using var messageBuffer = new MemoryStream();

        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            try
            {
                messageBuffer.SetLength(0);
                WebSocketReceiveResult result;

                do
                {
                    result = await webSocket
                        .ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken)
                        .ConfigureAwait(false);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        if (webSocket.State == WebSocketState.Open)
                            try
                            {
                                await webSocket.CloseOutputAsync(
                                    WebSocketCloseStatus.NormalClosure,
                                    "Closing",
                                    CancellationToken.None).ConfigureAwait(false);
                            }
                            catch
                            {
                                /* already closed */
                            }

                        return;
                    }

                    messageBuffer.Write(buffer, 0, result.Count);

                    if (messageBuffer.Length > MAX_MESSAGE_SIZE)
                    {
                        Logger.Warn($"[WebSocket] Message size {messageBuffer.Length} exceeds max {MAX_MESSAGE_SIZE}.");
                        if (webSocket.State == WebSocketState.Open)
                            try
                            {
                                await webSocket.CloseOutputAsync(
                                    WebSocketCloseStatus.MessageTooBig,
                                    $"Message exceeds maximum size of {MAX_MESSAGE_SIZE} bytes",
                                    CancellationToken.None).ConfigureAwait(false);
                            }
                            catch
                            {
                                /* already closed */
                            }

                        return;
                    }
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    // Decode directly from the buffer — no extra ToArray() copy.
                    var message = Encoding.UTF8.GetString(
                        messageBuffer.GetBuffer(), 0, (int)messageBuffer.Length);

                    OnMessageReceived?.Invoke(this, message);
                }
            }
            catch (WebSocketException ex)
            {
                Logger.Warn($"WebSocket exception: {ex.Message}");
                break;
            }
            catch (OperationCanceledException)
            {
                Logger.Log("WebSocket receive cancelled.");
                break;
            }
    }

    // -------------------------------------------------------------------------
    // Heartbeat
    // -------------------------------------------------------------------------

    private void StartHeartbeat()
    {
        _heartbeatTimer = new Timer(
            _ => CleanupDeadConnections(),
            null,
            HEARTBEAT_INTERVAL,
            HEARTBEAT_INTERVAL);
    }

    private void CleanupDeadConnections()
    {
        if (!IsRunning) return;

        List<WebSocket> snapshot;
        lock (_clientsLock)
        {
            snapshot = new List<WebSocket>(_connectedClients);
        }

        var dead = new List<WebSocket>();
        foreach (var client in snapshot)
            if (client.State != WebSocketState.Open &&
                client.State != WebSocketState.Connecting)
            {
                Logger.Log($"Heartbeat: dead connection detected (state={client.State}).");
                dead.Add(client);
            }

        if (dead.Count > 0)
        {
            RemoveDeadClients(dead);
            Logger.Log($"Heartbeat: cleaned up {dead.Count} dead connection(s).");
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void MarkForRemoval(WebSocket client, List<WebSocket> clientsToRemove)
    {
        lock (_clientsLock)
        {
            if (!clientsToRemove.Contains(client))
                clientsToRemove.Add(client);
        }
    }

    private void RemoveDeadClients(List<WebSocket> clients)
    {
        if (clients.Count == 0) return;

        lock (_clientsLock)
        {
            foreach (var client in clients)
            {
                _connectedClients.Remove(client);
                _clientPendingMessages.Remove(client);
                try
                {
                    client.Dispose();
                }
                catch (Exception ex)
                {
                    Logger.Warn($"Error disposing WebSocket client: {ex.Message}");
                }
            }
        }
    }

    /// <summary>
    ///     Ask the OS for a free port by binding to port 0 — no TOCTOU race.
    /// </summary>
    private static int FindAvailablePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            return ((IPEndPoint)listener.LocalEndpoint).Port;
        }
        finally
        {
            listener.Stop();
        }
    }
}
