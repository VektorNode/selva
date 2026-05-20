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

    private readonly object _clientsLock = new object();

    // Tracks per-client pending message count (for backpressure) and a semaphore (to serialize sends).
    // WebSocket.SendAsync is NOT concurrent-safe: only one send may be in-flight at a time per socket.
    private readonly Dictionary<WebSocket, ClientSendState> _clientState =
        new Dictionary<WebSocket, ClientSendState>();

    private readonly List<WebSocket> _connectedClients = new List<WebSocket>();

    private CancellationTokenSource _cancellationTokenSource;
    private bool _disposed;
    private Timer _heartbeatTimer;

    // .NET Framework 4.8 ships only the HttpListener-based WebSocket flow; modern .NET
    // (net7/net9, used by Mac/Linux Rhino) needs the manual TcpListener handshake because
    // HttpListener depends on the Windows-only Http.sys driver. Both code paths produce a
    // System.Net.WebSockets.WebSocket so the rest of this class is shared.
#if NET48
    private HttpListener _httpListener;
#else
    private TcpListener _tcpListener;
#endif

    public WebSocketServer(int port = AppConfig.WebSocket.DefaultPort)
    {
        Port = port;
    }

    public bool IsRunning { get; private set; }
    public int Port { get; private set; }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

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
        if (IsRunning)
        {
            return Task.CompletedTask;
        }

        _cancellationTokenSource = new CancellationTokenSource();

        // Try the preferred port, then fall back to a free one if it's taken.
        if (!TryBindListener(Port == 0 ? FindAvailablePort() : Port, out var boundPort))
        {
            var fallback = FindAvailablePort();
            if (!TryBindListener(fallback, out boundPort))
            {
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
    ///     Binds the underlying listener (HttpListener on net48, TcpListener elsewhere)
    ///     to the given port on the loopback interface. Returns true and sets
    ///     <paramref name="boundPort" /> on success; returns false on failure.
    /// </summary>
    private bool TryBindListener(int port, out int boundPort)
    {
#if NET48
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
            try { listener.Close(); } catch { /* ignore */ }
            boundPort = 0;
            return false;
        }
#else
        var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
            _tcpListener = listener;
            boundPort = ((IPEndPoint)listener.LocalEndpoint).Port;
            return true;
        }
        catch
        {
            try { listener.Stop(); } catch { /* ignore */ }
            boundPort = 0;
            return false;
        }
#endif
    }

    /// <summary>
    ///     Stop the WebSocket server and close all client connections.
    /// </summary>
    public void Stop()
    {
        // Lock for the whole Stop() so BroadcastAsync cannot interleave.
        lock (_clientsLock)
        {
            if (!IsRunning)
            {
                return;
            }

            IsRunning = false;
        }

        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;

        _cancellationTokenSource?.Cancel();

        lock (_clientsLock)
        {
            foreach (var client in _connectedClients)
            {
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
            }

            _connectedClients.Clear();
            foreach (var state in _clientState.Values)
            {
                state.Dispose();
            }

            _clientState.Clear();
        }

        try
        {
#if NET48
            _httpListener?.Stop();
            _httpListener?.Close();
#else
            _tcpListener?.Stop();
#endif
        }
        catch (Exception ex)
        {
            Logger.Error($"Error stopping WebSocket listener: {ex.Message}");
        }
        finally
        {
#if NET48
            _httpListener = null;
#else
            _tcpListener = null;
#endif
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
    ///     Send a UTF-8 text message to all connected clients with backpressure handling.
    /// </summary>
    public Task BroadcastAsync(string message)
    {
        if (!IsRunning)
        {
            return Task.CompletedTask;
        }

        var buffer = Encoding.UTF8.GetBytes(message);
        return BroadcastSegmentAsync(new ArraySegment<byte>(buffer), WebSocketMessageType.Text);
    }

    /// <summary>
    ///     Send a raw binary frame to all connected clients with backpressure handling.
    /// </summary>
    public Task BroadcastBinaryAsync(byte[] data)
    {
        if (!IsRunning)
        {
            return Task.CompletedTask;
        }

        return BroadcastSegmentAsync(new ArraySegment<byte>(data), WebSocketMessageType.Binary);
    }

    private async Task BroadcastSegmentAsync(ArraySegment<byte> segment, WebSocketMessageType messageType)
    {
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
                if (!_clientState.TryGetValue(client, out var state))
                {
                    continue;
                }

                if (state.PendingCount >= MAX_SEND_QUEUE)
                {
                    Logger.Warn($"Client send queue full ({state.PendingCount} pending), dropping message.");
                    continue;
                }

                state.PendingCount++;
            }

            tasks.Add(SendToClientAsync(client, segment, messageType, clientsToRemove));
        }

        if (tasks.Count > 0)
        {
            await Task.WhenAll(tasks).ConfigureAwait(false);
        }

        RemoveDeadClients(clientsToRemove);
    }

    /// <summary>
    ///     Send to a single client. Returns false if the send failed.
    /// </summary>
    private async Task SendToClientAsync(
        WebSocket client,
        ArraySegment<byte> segment,
        WebSocketMessageType messageType,
        List<WebSocket> clientsToRemove)
    {
        // Acquire per-client send lock so concurrent broadcast calls never overlap
        // on the same WebSocket (SendAsync is not concurrent-safe).
        ClientSendState state;
        lock (_clientsLock)
        {
            _clientState.TryGetValue(client, out state);
        }

        if (state == null)
        {
            return;
        }

        await state.SendLock.WaitAsync().ConfigureAwait(false);
        try
        {
            if (client.State != WebSocketState.Open)
            {
                MarkForRemoval(client, clientsToRemove);
                return;
            }

            using var cts = new CancellationTokenSource(BROADCAST_TIMEOUT);
            await client.SendAsync(segment, messageType, true, cts.Token)
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
            state.SendLock.Release();

            lock (_clientsLock)
            {
                if (_clientState.TryGetValue(client, out var s))
                {
                    s.PendingCount = Math.Max(0, s.PendingCount - 1);
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Connection handling
    // -------------------------------------------------------------------------

    private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
    {
#if NET48
        while (!cancellationToken.IsCancellationRequested && IsRunning)
        {
            try
            {
                var context = await _httpListener.GetContextAsync().ConfigureAwait(false);

                if (context.Request.IsWebSocketRequest)
                {
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
#else
        while (!cancellationToken.IsCancellationRequested && IsRunning)
        {
            TcpClient tcpClient;
            try
            {
                tcpClient = await _tcpListener.AcceptTcpClientAsync().ConfigureAwait(false);
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch (SocketException ex)
            {
                Logger.Warn($"WebSocket listener stopped: {ex.Message}");
                break;
            }
            catch (Exception ex)
            {
                Logger.Error($"Error accepting TCP connection: {ex.Message}");
                continue;
            }

            _ = Task.Run(
                () => ProcessWebSocketRequestAsync(tcpClient, cancellationToken),
                cancellationToken);
        }
#endif
    }

#if NET48
    /// <summary>
    ///     net48 path: HttpListener already negotiated the WebSocket upgrade, so we
    ///     just take ownership of the resulting WebSocket and enter the receive loop.
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

            if (!TryRegisterClient(webSocket))
            {
                await webSocket.CloseAsync(
                    WebSocketCloseStatus.PolicyViolation,
                    "Maximum client connections reached",
                    CancellationToken.None).ConfigureAwait(false);
                webSocket.Dispose();
                return;
            }

            OnClientConnected?.Invoke(this, webSocket);
            await ReceiveMessagesAsync(webSocket, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Error($"WebSocket request processing error: {ex.Message}");
        }
        finally
        {
            await TeardownClientAsync(webSocket).ConfigureAwait(false);
        }
    }
#else
    /// <summary>
    ///     net7+/net9 path: perform the RFC 6455 handshake manually on a raw TCP
    ///     connection (HttpListener's WebSocket support is Windows-only) and wrap the
    ///     resulting stream in a server-side WebSocket.
    /// </summary>
    private async Task ProcessWebSocketRequestAsync(
        TcpClient tcpClient,
        CancellationToken cancellationToken)
    {
        WebSocket webSocket = null;

        try
        {
            var networkStream = tcpClient.GetStream();

            HttpRequest request;
            try
            {
                request = await HttpRequestParser.ReadAsync(networkStream, cancellationToken).ConfigureAwait(false);
            }
            catch (InvalidDataException ex)
            {
                await WebSocketHandshake
                    .WriteErrorResponseAsync(networkStream, 400, "Bad Request", ex.Message, cancellationToken)
                    .ConfigureAwait(false);
                return;
            }

            string clientKey;
            try
            {
                clientKey = WebSocketHandshake.ValidateUpgradeRequest(request);
            }
            catch (HandshakeException ex)
            {
                await WebSocketHandshake
                    .WriteErrorResponseAsync(networkStream, ex.StatusCode, ex.StatusText, ex.Message, cancellationToken)
                    .ConfigureAwait(false);
                return;
            }

            var acceptKey = WebSocketHandshake.ComputeAcceptKey(clientKey);
            await WebSocketHandshake
                .WriteUpgradeResponseAsync(networkStream, acceptKey, cancellationToken)
                .ConfigureAwait(false);

            webSocket = WebSocket.CreateFromStream(
                networkStream,
                isServer: true,
                subProtocol: null,
                keepAliveInterval: TimeSpan.FromMilliseconds(HEARTBEAT_INTERVAL));

            if (!TryRegisterClient(webSocket))
            {
                await webSocket.CloseAsync(
                    WebSocketCloseStatus.PolicyViolation,
                    "Maximum client connections reached",
                    CancellationToken.None).ConfigureAwait(false);
                webSocket.Dispose();
                return;
            }

            OnClientConnected?.Invoke(this, webSocket);
            await ReceiveMessagesAsync(webSocket, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Error($"WebSocket request processing error: {ex.Message}");
        }
        finally
        {
            await TeardownClientAsync(webSocket).ConfigureAwait(false);

            // WebSocket.Dispose closes the underlying stream/socket. If we never got
            // that far (handshake failure path), close the TcpClient ourselves.
            if (webSocket == null)
            {
                try { tcpClient.Close(); } catch { /* ignore */ }
            }
        }
    }
#endif

    /// <summary>
    ///     Registers a newly-accepted client, enforcing the connection cap. Returns
    ///     false if the cap is reached (caller is responsible for closing the socket).
    /// </summary>
    private bool TryRegisterClient(WebSocket webSocket)
    {
        lock (_clientsLock)
        {
            if (_connectedClients.Count >= MAX_CLIENTS)
            {
                return false;
            }

            _connectedClients.Add(webSocket);
            _clientState[webSocket] = new ClientSendState();
            return true;
        }
    }

    /// <summary>
    ///     Releases a client's bookkeeping and closes the underlying socket. Safe to
    ///     call with a null webSocket (no-op) so callers can use a single finally block.
    /// </summary>
    private async Task TeardownClientAsync(WebSocket webSocket)
    {
        if (webSocket == null)
        {
            return;
        }

        lock (_clientsLock)
        {
            _connectedClients.Remove(webSocket);
            if (_clientState.TryGetValue(webSocket, out var s))
            {
                _clientState.Remove(webSocket);
                s.Dispose();
            }
        }

        try
        {
            if (webSocket.State == WebSocketState.Open)
            {
                await webSocket.CloseAsync(
                    WebSocketCloseStatus.NormalClosure,
                    "Connection closed",
                    CancellationToken.None).ConfigureAwait(false);
            }

            webSocket.Dispose();
        }
        catch (Exception ex)
        {
            Logger.Warn($"Error closing WebSocket: {ex.Message}");
        }
    }

    private async Task ReceiveMessagesAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        var buffer = new byte[BUFFER_SIZE];

        // MemoryStream avoids the per-chunk List<byte> + AddRange allocations.
        using var messageBuffer = new MemoryStream();

        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
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
                        {
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
                        }

                        return;
                    }

                    messageBuffer.Write(buffer, 0, result.Count);

                    if (messageBuffer.Length > MAX_MESSAGE_SIZE)
                    {
                        Logger.Warn($"[WebSocket] Message size {messageBuffer.Length} exceeds max {MAX_MESSAGE_SIZE}.");
                        if (webSocket.State == WebSocketState.Open)
                        {
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
        if (!IsRunning)
        {
            return;
        }

        List<WebSocket> snapshot;
        lock (_clientsLock)
        {
            snapshot = new List<WebSocket>(_connectedClients);
        }

        var dead = new List<WebSocket>();
        foreach (var client in snapshot)
        {
            if (client.State != WebSocketState.Open &&
                client.State != WebSocketState.Connecting)
            {
                Logger.Log($"Heartbeat: dead connection detected (state={client.State}).");
                dead.Add(client);
            }
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
            {
                clientsToRemove.Add(client);
            }
        }
    }

    private void RemoveDeadClients(List<WebSocket> clients)
    {
        if (clients.Count == 0)
        {
            return;
        }

        lock (_clientsLock)
        {
            foreach (var client in clients)
            {
                _connectedClients.Remove(client);
                if (_clientState.TryGetValue(client, out var s))
                {
                    _clientState.Remove(client);
                    s.Dispose();
                }

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

    /// <summary>
    ///     Per-client state: pending message count (backpressure) + send semaphore (serialization).
    ///     WebSocket.SendAsync must never be called concurrently on the same socket.
    /// </summary>
    private sealed class ClientSendState : IDisposable
    {
        public readonly SemaphoreSlim SendLock = new SemaphoreSlim(1, 1);
        public int PendingCount;

        public void Dispose()
        {
            SendLock.Dispose();
        }
    }
}
