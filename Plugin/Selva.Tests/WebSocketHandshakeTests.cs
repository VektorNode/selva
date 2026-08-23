using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

// Wire-format sensitive: pins the exact bytes the handshake emits and accepts.
public class WebSocketHandshakeTests
{
    // -------------------------------------------------------------------------
    // Sec-WebSocket-Accept hashing — RFC 6455 §1.3 canonical test vector
    // -------------------------------------------------------------------------

    [Fact]
    public void ComputeAcceptKey_MatchesRfc6455ReferenceVector()
    {
        var actual = WebSocketHandshake.ComputeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==");
        Assert.Equal("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", actual);
    }

    [Fact]
    public void ComputeAcceptKey_IsDeterministic()
    {
        var a = WebSocketHandshake.ComputeAcceptKey("x3JJHMbDL1EzLkh9GBhXDw==");
        var b = WebSocketHandshake.ComputeAcceptKey("x3JJHMbDL1EzLkh9GBhXDw==");
        Assert.Equal(a, b);
    }

    [Fact]
    public void ComputeAcceptKey_DifferentKeysProduceDifferentAccepts()
    {
        var a = WebSocketHandshake.ComputeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==");
        var b = WebSocketHandshake.ComputeAcceptKey("x3JJHMbDL1EzLkh9GBhXDw==");
        Assert.NotEqual(a, b);
    }

    // -------------------------------------------------------------------------
    // ContainsToken — header parsing edge cases
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("websocket", "websocket", true)]
    [InlineData("WebSocket", "websocket", true)]
    [InlineData("WEBSOCKET", "websocket", true)]
    [InlineData("keep-alive, Upgrade", "Upgrade", true)]
    [InlineData("Upgrade, keep-alive", "Upgrade", true)]
    [InlineData(" Upgrade ", "Upgrade", true)]
    [InlineData("Upgrades", "Upgrade", false)] // must be a token boundary, not substring
    [InlineData("close", "Upgrade", false)]
    [InlineData("", "Upgrade", false)]
    public void ContainsToken_RespectsCommaBoundariesAndCaseInsensitivity(
        string headerValue, string token, bool expected)
    {
        Assert.Equal(expected, WebSocketHandshake.ContainsToken(headerValue, token));
    }

    // -------------------------------------------------------------------------
    // ValidateUpgradeRequest — accept the good cases
    // -------------------------------------------------------------------------

    [Fact]
    public void ValidateUpgradeRequest_AcceptsWellFormedRequest()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Host", "localhost:8765"),
            ("Upgrade", "websocket"),
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "13"),
        });

        var key = WebSocketHandshake.ValidateUpgradeRequest(request);
        Assert.Equal("dGhlIHNhbXBsZSBub25jZQ==", key);
    }

    [Fact]
    public void ValidateUpgradeRequest_AcceptsCompoundConnectionHeader()
    {
        // Browsers commonly send "Connection: keep-alive, Upgrade"; that must be accepted.
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Host", "localhost:8765"),
            ("Upgrade", "websocket"),
            ("Connection", "keep-alive, Upgrade"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "13"),
        });

        var key = WebSocketHandshake.ValidateUpgradeRequest(request);
        Assert.Equal("dGhlIHNhbXBsZSBub25jZQ==", key);
    }

    // -------------------------------------------------------------------------
    // ValidateUpgradeRequest — reject the bad cases
    // -------------------------------------------------------------------------

    [Fact]
    public void ValidateUpgradeRequest_RejectsPostMethod()
    {
        var request = BuildRequest("POST", "/", "HTTP/1.1", MinimalUpgradeHeaders());
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(405, ex.StatusCode);
    }

    [Fact]
    public void ValidateUpgradeRequest_RejectsHttp10()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.0", MinimalUpgradeHeaders());
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(505, ex.StatusCode);
    }

    [Fact]
    public void ValidateUpgradeRequest_RejectsMissingUpgradeHeader()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "13"),
        });
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(400, ex.StatusCode);
    }

    [Fact]
    public void ValidateUpgradeRequest_RejectsMissingConnectionHeader()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Upgrade", "websocket"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "13"),
        });
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(400, ex.StatusCode);
    }

    [Fact]
    public void ValidateUpgradeRequest_RejectsUnsupportedWebSocketVersion()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Upgrade", "websocket"),
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "8"),
        });
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(426, ex.StatusCode);
    }

    [Fact]
    public void ValidateUpgradeRequest_RejectsMissingKey()
    {
        var request = BuildRequest("GET", "/", "HTTP/1.1", new[]
        {
            ("Upgrade", "websocket"),
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Version", "13"),
        });
        var ex = Assert.Throws<HandshakeException>(() => WebSocketHandshake.ValidateUpgradeRequest(request));
        Assert.Equal(400, ex.StatusCode);
    }

    // -------------------------------------------------------------------------
    // HttpRequestParser — request line and headers
    // -------------------------------------------------------------------------

    [Fact]
    public async Task ReadAsync_ParsesWellFormedRequest()
    {
        var raw =
            "GET /index.html HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "User-Agent: test\r\n" +
            "\r\n";

        var request = await ReadFromString(raw);

        Assert.Equal("GET", request.Method);
        Assert.Equal("/index.html", request.Target);
        Assert.Equal("HTTP/1.1", request.HttpVersion);
        Assert.Equal("localhost", request.GetHeader("Host"));
        Assert.Equal("test", request.GetHeader("User-Agent"));
    }

    [Fact]
    public async Task ReadAsync_HeadersAreCaseInsensitive()
    {
        var raw =
            "GET / HTTP/1.1\r\n" +
            "Host: localhost\r\n" +
            "\r\n";

        var request = await ReadFromString(raw);

        Assert.Equal("localhost", request.GetHeader("Host"));
        Assert.Equal("localhost", request.GetHeader("host"));
        Assert.Equal("localhost", request.GetHeader("HOST"));
    }

    [Fact]
    public async Task ReadAsync_CombinesRepeatedHeaders()
    {
        // RFC 7230 §3.2.2 — repeats are equivalent to a single header joined by ", ".
        var raw =
            "GET / HTTP/1.1\r\n" +
            "Accept: text/html\r\n" +
            "Accept: application/json\r\n" +
            "\r\n";

        var request = await ReadFromString(raw);

        Assert.Equal("text/html, application/json", request.GetHeader("Accept"));
    }

    [Fact]
    public async Task ReadAsync_ThrowsOnMalformedRequestLine()
    {
        var raw = "NOTANHTTPREQUEST\r\n\r\n";
        await Assert.ThrowsAsync<InvalidDataException>(() => ReadFromString(raw));
    }

    [Fact]
    public async Task ReadAsync_ThrowsOnHeaderWithoutColon()
    {
        var raw =
            "GET / HTTP/1.1\r\n" +
            "ThisIsNotAHeader\r\n" +
            "\r\n";
        await Assert.ThrowsAsync<InvalidDataException>(() => ReadFromString(raw));
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static async Task<HttpRequest> ReadFromString(string raw)
    {
        var bytes = Encoding.ASCII.GetBytes(raw);
        using var stream = new MemoryStream(bytes);
        return await HttpRequestParser.ReadAsync(stream, CancellationToken.None);
    }

    private static HttpRequest BuildRequest(
        string method, string target, string version, IEnumerable<(string, string)> headers)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, value) in headers)
        {
            dict[name] = value;
        }
        return new HttpRequest(method, target, version, dict);
    }

    private static (string, string)[] MinimalUpgradeHeaders()
    {
        return new (string, string)[]
        {
            ("Upgrade", "websocket"),
            ("Connection", "Upgrade"),
            ("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ=="),
            ("Sec-WebSocket-Version", "13"),
        };
    }
}
