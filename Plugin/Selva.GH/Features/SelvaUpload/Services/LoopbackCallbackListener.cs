#nullable enable
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.GH.Features.SelvaUpload.Services;

/// <summary>
///     Catches the OAuth redirect on 127.0.0.1 at a port the OS picks (RFC 8252 §7.3). A raw
///     TcpListener, as LocalWebServer is, so net48 never needs a URL reservation.
/// </summary>
public sealed class LoopbackCallbackListener : IDisposable
{
    private const int RequestReadTimeoutMs = 10_000;
    private const int MaxConcurrentRequests = 8;

    private readonly TcpListener _listener;
    private readonly int _port;

    private LoopbackCallbackListener(TcpListener listener)
    {
        _listener = listener;
        _port = ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    /// <summary>The IP literal, not "localhost": Selva's built-in client accepts only 127.0.0.1.</summary>
    public string RedirectUri => $"http://127.0.0.1:{_port}{OAuthCallback.CallbackPath}";

    public void Dispose()
    {
        try
        {
            _listener.Stop();
        }
        catch (SocketException)
        {
            // Already stopped.
        }
    }

    public static LoopbackCallbackListener Start()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return new LoopbackCallbackListener(listener);
    }

    /// <summary>
    ///     Answers requests until one is the callback for this sign-in, then returns its result.
    ///     Requests for other paths, with another Host, or with another state get an answer and are
    ///     otherwise ignored.
    /// </summary>
    /// <remarks>
    ///     Connections are handled concurrently: browsers open speculative sockets and leave them idle,
    ///     and a serial loop would hold the real redirect behind each one's read timeout.
    /// </remarks>
    public async Task<OAuthCallbackResult> WaitAsync(string state, string issuer, CancellationToken cancellationToken)
    {
        using var done = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        using var registration = done.Token.Register(Dispose);
        var found = new TaskCompletionSource<OAuthCallbackResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var slots = new SemaphoreSlim(MaxConcurrentRequests);

        var accepting = AcceptAsync();
        var first = await Task.WhenAny(found.Task, accepting).ConfigureAwait(false);
        done.Cancel();
        if (first == found.Task)
        {
            // The stopped listener fails the accept loop; observe it so it isn't reported as unobserved.
            _ = accepting.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
            return found.Task.Result;
        }

        cancellationToken.ThrowIfCancellationRequested();
        await accepting.ConfigureAwait(false);
        throw new InvalidOperationException("The callback listener stopped.");

        async Task AcceptAsync()
        {
            while (true)
            {
                await slots.WaitAsync(done.Token).ConfigureAwait(false);
                TcpClient client;
                try
                {
                    client = await _listener.AcceptTcpClientAsync().ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is ObjectDisposedException || ex is SocketException)
                {
                    done.Token.ThrowIfCancellationRequested();
                    throw;
                }

                _ = Task.Run(async () =>
                {
                    try
                    {
                        using (client)
                        {
                            var result = await HandleAsync(client, state, issuer, done.Token).ConfigureAwait(false);
                            if (result != null)
                            {
                                found.TrySetResult(result);
                            }
                        }
                    }
                    catch (Exception)
                    {
                        // One bad connection never ends the wait; cancellation ends it in the accept loop.
                    }
                    finally
                    {
                        try
                        {
                            slots.Release();
                        }
                        catch (ObjectDisposedException)
                        {
                            // The wait already returned.
                        }
                    }
                });
            }
        }
    }

    private async Task<OAuthCallbackResult?> HandleAsync(TcpClient client, string state, string issuer,
        CancellationToken cancellationToken)
    {
        var stream = client.GetStream();
        HttpRequest request;
        using (var readTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
        {
            readTimeout.CancelAfter(RequestReadTimeoutMs);
            try
            {
                request = await HttpRequestParser.ReadAsync(stream, readTimeout.Token).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is InvalidDataException || ex is IOException ||
                                       ex is OperationCanceledException)
            {
                cancellationToken.ThrowIfCancellationRequested();
                return null;
            }
        }

        if (request.Method != "GET" || request.GetHeader("Host") != $"127.0.0.1:{_port}")
        {
            await RespondAsync(stream, 400, "Bad Request", FailedPage).ConfigureAwait(false);
            return null;
        }

        var result = OAuthCallback.Parse(request.Target, state, issuer);
        if (result == null)
        {
            await RespondAsync(stream, 404, "Not Found", NotFoundPage).ConfigureAwait(false);
            return null;
        }

        switch (result.Kind)
        {
            case OAuthCallbackKind.Code:
                await RespondAsync(stream, 200, "OK", SignedInPage).ConfigureAwait(false);
                break;
            case OAuthCallbackKind.Cancelled:
                await RespondAsync(stream, 200, "OK", CancelledPage).ConfigureAwait(false);
                break;
            default:
                await RespondAsync(stream, 400, "Bad Request", FailedPage).ConfigureAwait(false);
                break;
        }

        return result.FromThisSignIn ? result : null;
    }

    // Fixed pages: nothing from the request is echoed back.
    private const string SignedInPage = "Signed in to Selva. You can close this tab and go back to Grasshopper.";
    private const string CancelledPage = "Sign-in cancelled. You can close this tab.";
    private const string FailedPage = "Sign-in didn't work. Go back to Grasshopper and try again.";
    private const string NotFoundPage = "Not found.";

    private static async Task RespondAsync(Stream stream, int status, string reason, string message)
    {
        var body = Encoding.UTF8.GetBytes(
            "<!doctype html><html><head><meta charset=\"utf-8\"><title>Selva</title>" +
            "<style>body{font:16px system-ui,sans-serif;margin:4rem auto;max-width:32rem;padding:0 1rem}</style>" +
            $"</head><body><p>{message}</p></body></html>");
        var head =
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Type: text/html; charset=utf-8\r\n" +
            $"Content-Length: {body.Length}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Referrer-Policy: no-referrer\r\n" +
            "X-Frame-Options: DENY\r\n" +
            "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\n" +
            "Connection: close\r\n\r\n";
        var headBytes = Encoding.ASCII.GetBytes(head);
        try
        {
            await stream.WriteAsync(headBytes, 0, headBytes.Length).ConfigureAwait(false);
            await stream.WriteAsync(body, 0, body.Length).ConfigureAwait(false);
            await stream.FlushAsync().ConfigureAwait(false);
        }
        catch (IOException)
        {
            // The browser went away; the result stands.
        }
    }
}
