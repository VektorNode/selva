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
///     WebSocket server for real-time communication with the web UI in local interactive mode.
/// </summary>
public class WebSocketServer : IDisposable
{
    private const int MAX_MESSAGE_SIZE = AppConfig.WebSocket.MaxMessageSizeBytes;
    private const int BUFFER_SIZE = AppConfig.WebSocket.BufferSizeBytes;
    private const int MAX_CLIENTS = AppConfig.WebSocket.MaxConcurrentClients;
    private const int HEARTBEAT_INTERVAL = AppConfig.WebSocket.HeartbeatIntervalMs;
    private const int BROADCAST_TIMEOUT = AppConfig.WebSocket.BroadcastTimeoutMs;
    private const long MAX_QUEUED_BYTES = AppConfig.WebSocket.MaxQueuedSendBytes;

    private readonly object _clientsLock = new object();

    private readonly Dictionary<WebSocket, ClientSendState> _clientState =
        new Dictionary<WebSocket, ClientSendState>();

    private readonly List<WebSocket> _connectedClients = new List<WebSocket>();

    private readonly string _secret;
    private readonly IReadOnlyCollection<string> _allowedOrigins;
    private readonly Func<string> _acknowledgement;

    private CancellationTokenSource _cancellationTokenSource;
    private bool _disposed;
    private Timer _heartbeatTimer;

    // TcpListener with a manual handshake, not HttpListener: HttpListener's WebSocket support
    // needs the Windows-only Http.sys driver.
    private TcpListener _tcpListener;

    /// <param name="acknowledgement">The reply to a socket that authenticated, built when it does.</param>
    public WebSocketServer(
        string secret,
        IReadOnlyCollection<string> allowedOrigins,
        int port = AppConfig.WebSocket.DefaultPort,
        Func<string> acknowledgement = null)
    {
        _secret = secret ?? throw new ArgumentNullException(nameof(secret));
        _allowedOrigins = allowedOrigins ?? throw new ArgumentNullException(nameof(allowedOrigins));
        _acknowledgement = acknowledgement ?? (() => BridgeAccess.AuthenticatedMessage(BridgeRole.Author));
        Port = port;
    }

    public bool IsRunning { get; private set; }
    public int Port { get; private set; }

    /// <summary>Whether an authenticated socket that declared <paramref name="host" /> is connected.</summary>
    public bool HasClientFrom(string host)
    {
        lock (_clientsLock)
        {
            foreach (var state in _clientState.Values)
            {
                if (state.Host == host)
                {
                    return true;
                }
            }
        }

        return false;
    }

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

    /// <summary>
    ///     Raised on the socket's receive thread, which waits for the handler: hand the frame off
    ///     rather than processing it inline.
    /// </summary>
    public event EventHandler<ClientFrame> OnMessageReceived;

    public event EventHandler<WebSocket> OnClientConnected;

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Starts the server. Tries the preferred port first, falls back to a random free port
    ///     if it's taken.
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

    private bool TryBindListener(int port, out int boundPort)
    {
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
    }

    public void Stop()
    {
        // Under the lock: flip IsRunning and detach the client collections. The actual socket
        // closes happen OUTSIDE the lock — CloseAsync().Wait() blocks up to ClientCloseTimeoutMs
        // per client, and holding _clientsLock across that stalls every broadcast snapshot
        // (taken synchronously on the Rhino UI thread at solve end) for the whole duration.
        List<WebSocket> clientsToClose;
        lock (_clientsLock)
        {
            if (!IsRunning)
            {
                return;
            }

            IsRunning = false;

            clientsToClose = new List<WebSocket>(_connectedClients);
            _connectedClients.Clear();
            foreach (var state in _clientState.Values)
            {
                state.Close();
            }

            _clientState.Clear();
        }

        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;

        _cancellationTokenSource?.Cancel();

        foreach (var client in clientsToClose)
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

        try
        {
            _tcpListener?.Stop();
        }
        catch (Exception ex)
        {
            Logger.Error($"Error stopping WebSocket listener: {ex.Message}");
        }
        finally
        {
            _tcpListener = null;
        }
    }

    ~WebSocketServer()
    {
        Dispose();
    }

    // -------------------------------------------------------------------------
    // Broadcast
    // -------------------------------------------------------------------------

    public Task BroadcastAsync(string message) => BroadcastAsync(message, null);

    /// <summary>
    ///     Queues <paramref name="message" /> and the <paramref name="binaryFrames" /> after it as one
    ///     unit per client, so no other broadcast lands between them: the page pairs mesh frames with
    ///     the `outputs` envelope before them by arrival order.
    /// </summary>
    public Task BroadcastAsync(string message, IReadOnlyList<byte[]> binaryFrames)
    {
        if (!IsRunning)
        {
            return Task.CompletedTask;
        }

        var frames = new List<OutgoingFrame>(1 + (binaryFrames?.Count ?? 0))
        {
            new OutgoingFrame(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text)
        };
        if (binaryFrames != null)
        {
            foreach (var data in binaryFrames)
            {
                frames.Add(new OutgoingFrame(data, WebSocketMessageType.Binary));
            }
        }

        return Broadcast(frames);
    }

    public Task BroadcastBinaryAsync(byte[] data)
    {
        if (!IsRunning)
        {
            return Task.CompletedTask;
        }

        return Broadcast(new[] { new OutgoingFrame(data, WebSocketMessageType.Binary) });
    }

    // Completes once every client has sent the frames or dropped. Callers need not await it for
    // ordering: each client sends in the order frames were queued.
    private Task Broadcast(IReadOnlyList<OutgoingFrame> frames)
    {
        List<ClientSendState> states;
        lock (_clientsLock)
        {
            states = new List<ClientSendState>(_clientState.Values);
        }

        // Outside the lock: an overflowing client drops itself, which takes it.
        var sends = new List<Task>(states.Count);
        foreach (var state in states)
        {
            sends.Add(state.Enqueue(frames));
        }

        return sends.Count == 0 ? Task.CompletedTask : Task.WhenAll(sends);
    }

    // -------------------------------------------------------------------------
    // Reply to one socket
    // -------------------------------------------------------------------------

    public Task SendAsync(WebSocket client, string message)
    {
        return SendDirectAsync(client, new OutgoingFrame(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text));
    }

    public Task SendBinaryAsync(WebSocket client, byte[] data)
    {
        return SendDirectAsync(client, new OutgoingFrame(data, WebSocketMessageType.Binary));
    }

    private Task SendDirectAsync(WebSocket client, OutgoingFrame frame)
    {
        if (!IsRunning)
        {
            return Task.CompletedTask;
        }

        ClientSendState state;
        lock (_clientsLock)
        {
            _clientState.TryGetValue(client, out state);
        }

        return state == null ? Task.CompletedTask : state.Enqueue(new[] { frame });
    }

    // A failed or timed-out send leaves the socket unusable, and a client that stopped reading
    // would hold everything queued behind it: drop the client, and it reconnects with a replay.
    private void DropClient(WebSocket client)
    {
        RemoveDeadClients(new List<WebSocket> { client });
    }

    // -------------------------------------------------------------------------
    // Connection handling
    // -------------------------------------------------------------------------

    private async Task AcceptConnectionsAsync(CancellationToken cancellationToken)
    {
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
    }

    // RFC 6455 handshake on the raw TCP connection, then wrap the stream in a server-side WebSocket.
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

            if (!IsAllowedUpgrade(request.GetHeader("Host"), request.GetHeader("Origin")))
            {
                await WebSocketHandshake
                    .WriteErrorResponseAsync(networkStream, 403, "Forbidden", "Origin or Host not allowed.",
                        cancellationToken)
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

            await ServeClientAsync(webSocket, cancellationToken).ConfigureAwait(false);
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

    private bool IsAllowedUpgrade(string host, string origin)
    {
        if (BridgeAccess.IsAllowedHost(host, Port) && BridgeAccess.IsAllowedOrigin(origin, _allowedOrigins))
        {
            return true;
        }

        var shown = string.IsNullOrEmpty(origin) ? "(none)" : origin.Length > 100 ? origin.Substring(0, 100) : origin;
        Logger.Warn($"[WebSocket] Refused a connection from origin {shown}: not this component's web UI.");
        return false;
    }

    /// <summary>
    ///     The socket is registered for broadcasts and handed to <see cref="OnMessageReceived" />
    ///     only after its first message proves it holds the secret.
    /// </summary>
    private async Task ServeClientAsync(WebSocket webSocket, CancellationToken cancellationToken)
    {
        var (authenticated, host) = await AuthenticateAsync(webSocket, cancellationToken).ConfigureAwait(false);
        if (!authenticated)
        {
            Logger.Warn("[WebSocket] Closed a socket that did not authenticate.");
            await CloseOutputQuietlyAsync(
                webSocket, (WebSocketCloseStatus)BridgeAccess.UnauthorizedCloseCode, "Unauthorized")
                .ConfigureAwait(false);
            return;
        }

        // Registered before the acknowledgement, so a full server refuses instead of acknowledging
        // and then dropping the socket.
        var ack = new OutgoingFrame(Encoding.UTF8.GetBytes(_acknowledgement()), WebSocketMessageType.Text);
        if (!TryRegisterClient(webSocket, host, ack, out var acknowledged))
        {
            await CloseOutputQuietlyAsync(
                webSocket, WebSocketCloseStatus.PolicyViolation, "Maximum client connections reached")
                .ConfigureAwait(false);
            return;
        }

        if (!await acknowledged.ConfigureAwait(false))
        {
            return;
        }

        OnClientConnected?.Invoke(this, webSocket);
        await ReceiveMessagesAsync(webSocket, host, cancellationToken).ConfigureAwait(false);
    }

    private async Task<(bool Authenticated, string Host)> AuthenticateAsync(WebSocket webSocket,
        CancellationToken cancellationToken)
    {
        var refused = (false, (string)null);
        var buffer = new byte[BridgeAccess.MaxAuthenticateBytes];
        var count = 0;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(AppConfig.WebSocket.AuthTimeoutMs);

        try
        {
            WebSocketReceiveResult result;
            do
            {
                if (count == buffer.Length)
                {
                    return refused;
                }

                result = await webSocket
                    .ReceiveAsync(new ArraySegment<byte>(buffer, count, buffer.Length - count), timeout.Token)
                    .ConfigureAwait(false);

                if (result.MessageType != WebSocketMessageType.Text)
                {
                    return refused;
                }

                count += result.Count;
            } while (!result.EndOfMessage);
        }
        catch (OperationCanceledException)
        {
            return refused;
        }
        catch (WebSocketException)
        {
            return refused;
        }

        var authenticated = BridgeAccess.TryAuthenticate(Encoding.UTF8.GetString(buffer, 0, count), _secret,
            out var host);
        return (authenticated, host);
    }

    // A cancelled receive leaves the socket Aborted, with nothing left to close.
    private static async Task CloseOutputQuietlyAsync(WebSocket webSocket, WebSocketCloseStatus status,
        string reason)
    {
        if (webSocket.State != WebSocketState.Open)
        {
            return;
        }

        try
        {
            using var timeout = new CancellationTokenSource(AppConfig.WebSocket.ClientCloseTimeoutMs);
            await webSocket.CloseOutputAsync(status, reason, timeout.Token).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Warn($"Error closing WebSocket: {ex.Message}");
        }
    }

    // Returns false if MAX_CLIENTS is reached; caller closes the socket in that case. The
    // acknowledgement is queued under the same lock that registers the socket, so no broadcast
    // reaches the page before it.
    private bool TryRegisterClient(WebSocket webSocket, string host, OutgoingFrame acknowledgement,
        out Task<bool> acknowledged)
    {
        lock (_clientsLock)
        {
            if (_connectedClients.Count >= MAX_CLIENTS)
            {
                acknowledged = null;
                return false;
            }

            var state = new ClientSendState(webSocket, host, DropClient);
            _connectedClients.Add(webSocket);
            _clientState[webSocket] = state;
            acknowledged = state.Enqueue(new[] { acknowledgement });
            return true;
        }
    }

    // No-op on null so callers can call this unconditionally from a finally block.
    private async Task TeardownClientAsync(WebSocket webSocket)
    {
        if (webSocket == null)
        {
            return;
        }

        lock (_clientsLock)
        {
            _connectedClients.Remove(webSocket);
            if (_clientState.TryGetValue(webSocket, out var state))
            {
                state.Close();
                _clientState.Remove(webSocket);
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

    private async Task ReceiveMessagesAsync(WebSocket webSocket, string host, CancellationToken cancellationToken)
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

                    OnMessageReceived?.Invoke(this, new ClientFrame(webSocket, host, message, null));
                }
                else if (result.MessageType == WebSocketMessageType.Binary)
                {
                    // Copied out: the buffer is reused for the next frame.
                    OnMessageReceived?.Invoke(this, new ClientFrame(webSocket, host, null, messageBuffer.ToArray()));
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
                if (_clientState.TryGetValue(client, out var state))
                {
                    state.Close();
                    _clientState.Remove(client);
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

    // Binding to port 0 asks the OS for a free port with no TOCTOU race.
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

    private readonly struct OutgoingFrame
    {
        public OutgoingFrame(byte[] data, WebSocketMessageType type)
        {
            Data = data;
            Type = type;
        }

        public byte[] Data { get; }
        public WebSocketMessageType Type { get; }
    }

    /// <summary>
    ///     One client's outgoing queue and the loop that drains it. Each client sends on its own, so
    ///     a page that stops reading (the panel while Rhino solves) delays only itself, and a queued
    ///     unit's frames go out back to back. WebSocket.SendAsync allows one send at a time per
    ///     socket; only the drain loop calls it.
    /// </summary>
    private sealed class ClientSendState
    {
        private readonly Action<WebSocket> _drop;
        private readonly Queue<Outgoing> _queue = new Queue<Outgoing>();
        private readonly WebSocket _socket;
        private bool _closed;
        private bool _draining;
        private long _queuedBytes;

        public ClientSendState(WebSocket socket, string host, Action<WebSocket> drop)
        {
            _socket = socket;
            _drop = drop;
            Host = host;
        }

        /// <summary>What the socket declared when it authenticated; null for a browser tab.</summary>
        public string Host { get; }

        /// <summary>True once the frames are sent, false if the client was dropped first.</summary>
        public Task<bool> Enqueue(IReadOnlyList<OutgoingFrame> frames)
        {
            var item = new Outgoing(frames);
            var overflow = false;
            var startDrain = false;
            lock (_queue)
            {
                if (_closed)
                {
                    return Task.FromResult(false);
                }

                // One unit always fits, however large: only a backlog means the page stopped reading.
                if (_queue.Count > 0 && _queuedBytes + item.Bytes > MAX_QUEUED_BYTES)
                {
                    overflow = true;
                }
                else
                {
                    _queue.Enqueue(item);
                    _queuedBytes += item.Bytes;
                    startDrain = !_draining;
                    _draining = true;
                }
            }

            if (overflow)
            {
                Logger.Warn($"[WebSocket] Dropped a client with {_queuedBytes / (1024 * 1024)} MB unsent.");
                _drop(_socket);
                return Task.FromResult(false);
            }

            if (startDrain)
            {
                _ = Task.Run(DrainAsync);
            }

            return item.Done.Task;
        }

        /// <summary>Fails everything still queued. The drain loop stops at its next unit.</summary>
        public void Close()
        {
            Outgoing[] pending;
            lock (_queue)
            {
                _closed = true;
                pending = _queue.ToArray();
                _queue.Clear();
                _queuedBytes = 0;
            }

            foreach (var item in pending)
            {
                item.Done.TrySetResult(false);
            }
        }

        private async Task DrainAsync()
        {
            while (true)
            {
                Outgoing item;
                lock (_queue)
                {
                    if (_closed || _queue.Count == 0)
                    {
                        _draining = false;
                        return;
                    }

                    item = _queue.Dequeue();
                    _queuedBytes -= item.Bytes;
                }

                try
                {
                    foreach (var frame in item.Frames)
                    {
                        using var timeout = new CancellationTokenSource(BROADCAST_TIMEOUT);
                        await _socket.SendAsync(new ArraySegment<byte>(frame.Data), frame.Type, true, timeout.Token)
                            .ConfigureAwait(false);
                    }

                    item.Done.TrySetResult(true);
                }
                catch (Exception ex)
                {
                    item.Done.TrySetResult(false);
                    Logger.Warn(ex is OperationCanceledException
                        ? "[WebSocket] Send timed out: dropping the client."
                        : $"[WebSocket] Send failed: {ex.Message}");
                    _drop(_socket);
                    return;
                }
            }
        }

        private sealed class Outgoing
        {
            public Outgoing(IReadOnlyList<OutgoingFrame> frames)
            {
                Frames = frames;
                foreach (var frame in frames)
                {
                    Bytes += frame.Data.Length;
                }
            }

            public IReadOnlyList<OutgoingFrame> Frames { get; }
            public long Bytes { get; }

            public TaskCompletionSource<bool> Done { get; } =
                new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        }
    }
}

/// <summary>
///     One whole frame from an authenticated socket: <see cref="Text" /> or <see cref="Data" />,
///     never both. <see cref="Host" /> is what the socket declared when it authenticated, null for a
///     browser tab.
/// </summary>
public sealed class ClientFrame
{
    public ClientFrame(WebSocket client, string host, string text, byte[] data)
    {
        Client = client;
        Host = host;
        Text = text;
        Data = data;
    }

    public WebSocket Client { get; }
    public string Host { get; }
    public string Text { get; }
    public byte[] Data { get; }
}
