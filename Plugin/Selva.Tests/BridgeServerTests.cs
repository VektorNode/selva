using System;
using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

/// <summary>
///     The bridge over a real loopback socket: what a web page in the user's browser can and can't
///     do. Runs the TcpListener path that Rhino 8 on macOS and Rhino 9 use; net48's HttpListener
///     path shares everything after the handshake.
/// </summary>
public sealed class BridgeServerTests : IAsyncLifetime
{
    private const string Secret = "the-secret";
    private const string PageOrigin = "http://localhost:4242";
    private const int AppConfigClientLimit = Selva.GH.Config.AppConfig.WebSocket.MaxConcurrentClients;

    private readonly ConcurrentQueue<ClientFrame> _received = new();
    private WebSocketServer _server = null!;

    public async Task InitializeAsync()
    {
        _server = new WebSocketServer(Secret, BridgeAccess.LoopbackOrigins(4242), port: 0);
        _server.OnMessageReceived += (_, frame) => _received.Enqueue(frame);
        await _server.StartAsync();
    }

    public Task DisposeAsync()
    {
        _server.Dispose();
        return Task.CompletedTask;
    }

    [Theory]
    [InlineData("https://evil.example")]
    [InlineData("http://localhost:5173")]
    [InlineData(null)]
    public async Task Handshake_FromAnotherOrigin_IsRefused(string? origin)
    {
        var status = await RawHandshakeStatusAsync($"localhost:{_server.Port}", origin);
        Assert.Equal(403, status);
    }

    [Fact]
    public async Task Handshake_WithARebindingHost_IsRefused()
    {
        var status = await RawHandshakeStatusAsync($"evil.example:{_server.Port}", PageOrigin);
        Assert.Equal(403, status);
    }

    [Fact]
    public async Task Handshake_FromThePage_Upgrades()
    {
        var status = await RawHandshakeStatusAsync($"localhost:{_server.Port}", PageOrigin);
        Assert.Equal(101, status);
    }

    [Fact]
    public async Task Socket_WithTheSecret_IsAcknowledgedAndHeard()
    {
        using var socket = await ConnectAsync();
        await SendAsync(socket, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
        Assert.Equal("{\"type\":\"authenticated\",\"role\":\"author\"}", await ReceiveTextAsync(socket));

        await SendAsync(socket, "{\"type\":\"requestInitialData\",\"sessionId\":\"s\"}");
        await WaitUntilAsync(() => !_received.IsEmpty);
        var frame = Assert.Single(_received);
        Assert.Equal("{\"type\":\"requestInitialData\",\"sessionId\":\"s\"}", frame.Text);
        Assert.Null(frame.Host);
    }

    [Fact]
    public async Task Socket_FromTheRhinoPanel_CarriesItsHostOnEveryFrame()
    {
        using var socket = await ConnectAsync();
        await SendAsync(socket, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\",\"host\":\"rhino\"}");
        await ReceiveTextAsync(socket);

        await SendAsync(socket, "{\"type\":\"requestInitialData\",\"sessionId\":\"s\"}");
        await socket.SendAsync(new ArraySegment<byte>(new byte[] { 1, 2, 3 }), WebSocketMessageType.Binary, true,
            Timeout());
        await WaitUntilAsync(() => _received.Count == 2);

        var frames = _received.ToArray();
        Assert.All(frames, f => Assert.Equal(BridgeAccess.PanelHost, f.Host));
        Assert.NotNull(frames[0].Text);
        Assert.Equal(new byte[] { 1, 2, 3 }, frames[1].Data);
        Assert.Null(frames[1].Text);
    }

    // The bridge lengthens its schedule delay only while the panel is connected.
    [Fact]
    public async Task HasClientFrom_SeesTheRhinoPanelOnlyWhileItIsConnected()
    {
        using var tab = await ConnectAsync();
        await SendAsync(tab, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
        await ReceiveTextAsync(tab);
        Assert.False(_server.HasClientFrom(BridgeAccess.PanelHost));

        using var panel = await ConnectAsync();
        await SendAsync(panel, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\",\"host\":\"rhino\"}");
        await ReceiveTextAsync(panel);
        Assert.True(_server.HasClientFrom(BridgeAccess.PanelHost));

        await panel.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", Timeout());
        await WaitUntilAsync(() => !_server.HasClientFrom(BridgeAccess.PanelHost));
        Assert.False(_server.HasClientFrom(BridgeAccess.PanelHost));
    }

    [Fact]
    public async Task Send_ReachesOnlyTheSocketItNames()
    {
        using var asker = await ConnectAsync();
        await SendAsync(asker, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
        await ReceiveTextAsync(asker);
        using var bystander = await ConnectAsync();
        await SendAsync(bystander, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
        await ReceiveTextAsync(bystander);

        await SendAsync(asker, "{\"type\":\"hostPickFile\"}");
        await WaitUntilAsync(() => !_received.IsEmpty);
        var askerOnServer = Assert.Single(_received).Client;

        await _server.SendAsync(askerOnServer, "{\"type\":\"hostPickFileResult\"}");
        await _server.SendBinaryAsync(askerOnServer, new byte[] { 9 });
        await _server.BroadcastAsync("{\"type\":\"solvingState\"}");

        Assert.Equal("{\"type\":\"hostPickFileResult\"}", await ReceiveTextAsync(asker));
        var binary = await asker.ReceiveAsync(new ArraySegment<byte>(new byte[16]), Timeout());
        Assert.Equal(WebSocketMessageType.Binary, binary.MessageType);
        Assert.Equal("{\"type\":\"solvingState\"}", await ReceiveTextAsync(asker));
        Assert.Equal("{\"type\":\"solvingState\"}", await ReceiveTextAsync(bystander));
    }

    [Fact]
    public async Task Socket_WithAWrongSecret_IsClosedUnheard()
    {
        using var socket = await ConnectAsync();
        await SendAsync(socket, "{\"type\":\"authenticate\",\"secret\":\"guess\"}");

        var result = await socket.ReceiveAsync(new ArraySegment<byte>(new byte[256]), Timeout());
        Assert.Equal(WebSocketMessageType.Close, result.MessageType);
        Assert.Equal(BridgeAccess.UnauthorizedCloseCode, (int?)result.CloseStatus);
        Assert.Empty(_received);
    }

    [Fact]
    public async Task Socket_ThatSkipsAuthentication_CannotRequestInitialData()
    {
        using var socket = await ConnectAsync();
        await SendAsync(socket, "{\"type\":\"requestInitialData\",\"sessionId\":\"s\"}");

        var result = await socket.ReceiveAsync(new ArraySegment<byte>(new byte[256]), Timeout());
        Assert.Equal(WebSocketMessageType.Close, result.MessageType);
        Assert.Equal(BridgeAccess.UnauthorizedCloseCode, (int?)result.CloseStatus);
        Assert.Empty(_received);
    }

    [Fact]
    public async Task Broadcast_SkipsASocketThatHasNotAuthenticated()
    {
        using var member = await ConnectAsync();
        await SendAsync(member, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
        await ReceiveTextAsync(member);

        using var stranger = await ConnectAsync();
        await _server.BroadcastAsync("{\"type\":\"initialData\"}");
        Assert.Equal("{\"type\":\"initialData\"}", await ReceiveTextAsync(member));

        // The stranger's first frame is the close, not the broadcast it was connected for.
        await SendAsync(stranger, "{\"type\":\"authenticate\",\"secret\":\"guess\"}");
        var result = await stranger.ReceiveAsync(new ArraySegment<byte>(new byte[256]), Timeout());
        Assert.Equal(WebSocketMessageType.Close, result.MessageType);
    }

    // A page told it's connected and then dropped would reconnect forever.
    [Fact]
    public async Task Socket_OverTheClientLimit_IsRefusedWithoutAnAcknowledgement()
    {
        var members = new List<ClientWebSocket>();
        try
        {
            for (var i = 0; i < AppConfigClientLimit; i++)
            {
                var member = await ConnectAsync();
                await SendAsync(member, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
                await ReceiveTextAsync(member);
                members.Add(member);
            }

            using var extra = await ConnectAsync();
            await SendAsync(extra, "{\"type\":\"authenticate\",\"secret\":\"" + Secret + "\"}");
            var result = await extra.ReceiveAsync(new ArraySegment<byte>(new byte[256]), Timeout());

            Assert.Equal(WebSocketMessageType.Close, result.MessageType);
            Assert.Equal(WebSocketCloseStatus.PolicyViolation, result.CloseStatus);
        }
        finally
        {
            members.ForEach(m => m.Dispose());
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static CancellationToken Timeout() => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;

    private async Task<ClientWebSocket> ConnectAsync()
    {
        var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", PageOrigin);
        await socket.ConnectAsync(new Uri($"ws://localhost:{_server.Port}"), Timeout());
        return socket;
    }

    private static Task SendAsync(WebSocket socket, string text)
    {
        return socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(text)), WebSocketMessageType.Text,
            true, Timeout());
    }

    private static async Task<string> ReceiveTextAsync(WebSocket socket)
    {
        var buffer = new byte[4096];
        var result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), Timeout());
        Assert.Equal(WebSocketMessageType.Text, result.MessageType);
        return Encoding.UTF8.GetString(buffer, 0, result.Count);
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(10);
        }
    }

    // ClientWebSocket won't send a forged Host or omit Origin on request, so these go by hand.
    private async Task<int> RawHandshakeStatusAsync(string host, string? origin)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", _server.Port);
        var stream = client.GetStream();

        var request =
            "GET / HTTP/1.1\r\n" +
            $"Host: {host}\r\n" +
            (origin != null ? $"Origin: {origin}\r\n" : "") +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        var bytes = Encoding.ASCII.GetBytes(request);
        await stream.WriteAsync(bytes, 0, bytes.Length);

        var buffer = new byte[64];
        var read = await stream.ReadAsync(buffer, 0, buffer.Length);
        var statusLine = Encoding.ASCII.GetString(buffer, 0, read);
        return int.Parse(statusLine.Substring("HTTP/1.1 ".Length, 3));
    }
}
