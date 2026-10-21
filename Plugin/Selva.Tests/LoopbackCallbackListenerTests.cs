using System.Net.Sockets;
using System.Text;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class LoopbackCallbackListenerTests
{
    private const string State = "state-123";
    private const string Issuer = "https://selva.example.com";
    private const string Iss = "iss=https%3A%2F%2Fselva.example.com";

    [Fact]
    public void RedirectUri_IsLoopbackIpWithTheBoundPort()
    {
        using var listener = LoopbackCallbackListener.Start();
        Assert.Matches(@"^http://127\.0\.0\.1:\d+/callback$", listener.RedirectUri);
    }

    [Fact]
    public async Task Callback_WithTheCode_EndsTheWaitWithAFixedPage()
    {
        using var listener = LoopbackCallbackListener.Start();
        var wait = listener.WaitAsync(State, Issuer, Timeout());

        var response = await GetAsync(listener, $"/callback?code=the-code&state={State}&{Iss}");

        var result = await wait;
        Assert.Equal(OAuthCallbackKind.Code, result.Kind);
        Assert.Equal("the-code", result.Code);
        Assert.StartsWith("HTTP/1.1 200", response);
        Assert.Contains("Signed in", response);
        Assert.DoesNotContain("the-code", response);
        Assert.Contains("Content-Security-Policy: default-src 'none'", response);
    }

    [Fact]
    public async Task ForeignRequests_AreAnsweredButDoNotEndTheWait()
    {
        using var listener = LoopbackCallbackListener.Start();
        var wait = listener.WaitAsync(State, Issuer, Timeout());

        Assert.StartsWith("HTTP/1.1 404", await GetAsync(listener, "/favicon.ico"));
        Assert.StartsWith("HTTP/1.1 400", await GetAsync(listener, $"/callback?code=x&state=forged&{Iss}"));
        Assert.StartsWith("HTTP/1.1 400",
            await GetAsync(listener, $"/callback?code=x&state={State}&{Iss}", host: "evil.example"));
        Assert.False(wait.IsCompleted);

        await GetAsync(listener, $"/callback?error=access_denied&state={State}&{Iss}");
        Assert.Equal(OAuthCallbackKind.Cancelled, (await wait).Kind);
    }

    [Fact]
    public async Task Wait_GivesUpWhenCancelled()
    {
        using var listener = LoopbackCallbackListener.Start();
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => listener.WaitAsync(State, Issuer, cts.Token));
    }

    private static CancellationToken Timeout() => new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token;

    private static async Task<string> GetAsync(LoopbackCallbackListener listener, string target, string? host = null)
    {
        var port = new Uri(listener.RedirectUri).Port;
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", port);
        var stream = client.GetStream();
        var request = $"GET {target} HTTP/1.1\r\nHost: {host ?? "127.0.0.1:" + port}\r\nConnection: close\r\n\r\n";
        var bytes = Encoding.ASCII.GetBytes(request);
        await stream.WriteAsync(bytes, 0, bytes.Length);

        using var reader = new StreamReader(stream, Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }
}
