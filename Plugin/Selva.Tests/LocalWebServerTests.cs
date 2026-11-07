using System.Net.Sockets;
using System.Text;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

/// <summary>
///     The embedded web server over a real loopback socket. This test assembly embeds no web assets,
///     so a request that gets past the checks ends in 404.
/// </summary>
public sealed class LocalWebServerTests : IDisposable
{
    private readonly LocalWebServer _server = new();

    public LocalWebServerTests()
    {
        _server.Start();
    }

    public void Dispose()
    {
        _server.Dispose();
    }

    [Theory]
    [InlineData("localhost")]
    [InlineData("127.0.0.1")]
    public async Task Get_FromLoopbackOnThisPort_PassesTheHostCheck(string name)
    {
        var response = await SendAsync("GET", $"{name}:{_server.Port}");
        Assert.StartsWith("HTTP/1.1 404 ", response);
    }

    // A rebound name reaches 127.0.0.1, but the browser still sends that name as Host.
    [Theory]
    [InlineData("evil.example:{port}")]
    [InlineData("localhost:1")]
    [InlineData("localhost")]
    [InlineData(null)]
    public async Task Get_WithAnyOtherHost_IsForbidden(string? host)
    {
        var response = await SendAsync("GET", host?.Replace("{port}", _server.Port.ToString()));
        Assert.StartsWith("HTTP/1.1 403 ", response);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    [InlineData("OPTIONS")]
    public async Task AnyMethodButGetOrHead_IsNotAllowed(string method)
    {
        var response = await SendAsync(method, $"localhost:{_server.Port}");
        Assert.StartsWith("HTTP/1.1 405 ", response);
        Assert.Contains("\r\nAllow: GET, HEAD\r\n", response);
    }

    [Fact]
    public async Task ARebindingHost_IsRefusedBeforeTheMethodIsLookedAt()
    {
        var response = await SendAsync("POST", $"evil.example:{_server.Port}");
        Assert.StartsWith("HTTP/1.1 403 ", response);
    }

    [Fact]
    public async Task Head_PassesTheMethodCheck()
    {
        var response = await SendAsync("HEAD", $"localhost:{_server.Port}");
        Assert.StartsWith("HTTP/1.1 404 ", response);
    }

    private async Task<string> SendAsync(string method, string? host)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", _server.Port);
        var stream = client.GetStream();

        var request = $"{method} / HTTP/1.1\r\n" + (host != null ? $"Host: {host}\r\n" : "") + "\r\n";
        var bytes = Encoding.ASCII.GetBytes(request);
        await stream.WriteAsync(bytes);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var reader = new StreamReader(stream, Encoding.ASCII);
        return await reader.ReadToEndAsync(timeout.Token);
    }
}
