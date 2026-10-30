#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Selva.GH.Features.SelvaUpload.Services;

public sealed class SelvaApiException : Exception
{
    public SelvaApiException(string message, int? status = null, bool invalidToken = false,
        Exception? inner = null)
        : base(message, inner)
    {
        Status = status;
        InvalidToken = invalidToken;
    }

    public int? Status { get; }

    /// <summary>Selva no longer accepts the key: expired, revoked, or its owner lost the right to hold it.</summary>
    public bool InvalidToken { get; }
}

/// <summary>
///     HTTP to one Selva instance. Separate from FileImporter's client on purpose: that one refuses
///     private addresses, and a company's Selva often is one. Here the user chose the host, so the
///     rules are about not leaking the key: requests go only to the origin, redirects are errors
///     rather than followed, and certificate validation is never touched.
/// </summary>
public sealed class SelvaApiClient : IDisposable
{
    public const long MaxJsonBytes = 4 * 1024 * 1024;

    private static readonly TimeSpan JsonTimeout = TimeSpan.FromSeconds(30);

    // Selva checks the file on Rhino.Compute before it answers an upload.
    private static readonly TimeSpan UploadTimeout = TimeSpan.FromMinutes(10);

    private const int UploadAttempts = 3;

    private readonly HttpClient _http;
    private readonly string _origin;
    private readonly string? _token;
    private readonly string _userAgent;

    public SelvaApiClient(string origin, string? token, string userAgent, HttpMessageHandler handler)
    {
        _origin = origin;
        _token = token;
        _userAgent = userAgent;
        _http = new HttpClient(handler) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
    }

    public string Origin => _origin;

    public void Dispose()
    {
        _http.Dispose();
    }

    /// <summary>Redirects off, cookies off, the system proxy and certificate checks as they are.</summary>
    public static HttpMessageHandler CreateHandler()
    {
        return new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            ConnectTimeout = TimeSpan.FromSeconds(15)
        };
    }

    public Task<JObject> GetJsonAsync(string path, CancellationToken cancellationToken)
    {
        return SendJsonAsync(() => new HttpRequestMessage(HttpMethod.Get, Resolve(path)), JsonTimeout,
            cancellationToken);
    }

    public Task<JObject> PostJsonAsync(string path, JObject body, CancellationToken cancellationToken)
    {
        return SendJsonAsync(() => new HttpRequestMessage(HttpMethod.Post, Resolve(path))
        {
            Content = new StringContent(body.ToString(Formatting.None), Encoding.UTF8, "application/json")
        }, JsonTimeout, cancellationToken);
    }

    public Task<JObject> DeleteAsync(string path, CancellationToken cancellationToken)
    {
        return SendJsonAsync(() => new HttpRequestMessage(HttpMethod.Delete, Resolve(path)), JsonTimeout,
            cancellationToken);
    }

    /// <summary>
    ///     One Idempotency-Key for the attempt, reused by its retries, so a retry after a dropped
    ///     connection can't create the definition twice. Only connection failures are retried; an
    ///     answer from Selva, even an error, is final.
    /// </summary>
    public async Task<JObject> PostMultipartAsync(string path, Func<HttpContent> content,
        CancellationToken cancellationToken)
    {
        var url = Resolve(path);
        var idempotencyKey = Guid.NewGuid().ToString();

        for (var attempt = 1;; attempt++)
        {
            try
            {
                return await SendJsonAsync(() =>
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content() };
                    request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
                    return request;
                }, UploadTimeout, cancellationToken).ConfigureAwait(false);
            }
            catch (SelvaApiException ex) when (ex.Status == null && ex.InnerException is HttpRequestException &&
                                               attempt < UploadAttempts)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt), cancellationToken).ConfigureAwait(false);
            }
        }
    }

    /// <summary>Returns the raw key. The token endpoint must be on this origin, as the metadata check ensures.</summary>
    public async Task<string> RedeemCodeAsync(string tokenEndpoint, string code, string redirectUri,
        string codeVerifier, CancellationToken cancellationToken)
    {
        if (!SelvaOrigin.IsOnOrigin(tokenEndpoint, _origin))
        {
            throw new SelvaApiException("The token endpoint isn't on this Selva instance.");
        }

        var form = new[]
        {
            new KeyValuePair<string, string>("grant_type", "authorization_code"),
            new KeyValuePair<string, string>("code", code),
            new KeyValuePair<string, string>("client_id", OAuthCallback.ClientId),
            new KeyValuePair<string, string>("redirect_uri", redirectUri),
            new KeyValuePair<string, string>("code_verifier", codeVerifier),
            new KeyValuePair<string, string>("resource", _origin)
        };

        var json = await SendJsonAsync(() => new HttpRequestMessage(HttpMethod.Post, new Uri(tokenEndpoint))
        {
            Content = new FormUrlEncodedContent(form)
        }, JsonTimeout, cancellationToken, authenticate: false).ConfigureAwait(false);

        var token = json["access_token"]?.Type == JTokenType.String ? (string?)json["access_token"] : null;
        if (token == null || !ApiKeyFormat.IsWellFormed(token) ||
            !string.Equals((string?)json["token_type"], "Bearer", StringComparison.OrdinalIgnoreCase))
        {
            throw new SelvaApiException("Selva's token endpoint didn't return a Selva key.");
        }

        return token;
    }

    private Uri Resolve(string path)
    {
        if (!path.StartsWith("/", StringComparison.Ordinal) || path.StartsWith("//", StringComparison.Ordinal))
        {
            throw new SelvaApiException($"Not a path on the Selva instance: {path}");
        }

        return new Uri(_origin + path);
    }

    private async Task<JObject> SendJsonAsync(Func<HttpRequestMessage> build, TimeSpan timeout,
        CancellationToken cancellationToken, bool authenticate = true)
    {
        using var request = build();
        if (!SelvaOrigin.IsOnOrigin(request.RequestUri?.ToString(), _origin))
        {
            throw new SelvaApiException("The plugin only talks to the Selva instance it signed in to.");
        }

        request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (authenticate && _token != null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        }

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new SelvaApiException($"Selva didn't answer within {timeout.TotalSeconds:0} seconds.");
        }
        catch (HttpRequestException ex)
        {
            throw new SelvaApiException($"Couldn't reach {SelvaOrigin.DisplayHost(_origin)}: {ex.Message}",
                inner: ex);
        }

        using (response)
        {
            var status = (int)response.StatusCode;
            if (status >= 300 && status < 400)
            {
                var target = response.Headers.Location?.ToString() ?? "somewhere else";
                throw new SelvaApiException(
                    $"Selva answered with a redirect to {target}. The plugin doesn't follow redirects: " +
                    "check the instance address.", status);
            }

            var body = await ReadCappedAsync(response.Content).ConfigureAwait(false);
            if (status >= 200 && status < 300)
            {
                return ParseObject(body) ?? new JObject();
            }

            // The OAuth token endpoint answers RFC 6749's `error_description`, /api/v1 its `message`.
            var error = ParseObject(body);
            var message = StringOf(error?["message"]) ?? StringOf(error?["error_description"]) ??
                          $"Selva answered {status} {response.ReasonPhrase}.";
            var invalidToken = status == 401 && response.Headers.WwwAuthenticate.Any(h =>
                h.Parameter != null && h.Parameter.Contains("invalid_token"));
            throw new SelvaApiException(message, status, invalidToken);
        }
    }

    private static async Task<string> ReadCappedAsync(HttpContent? content)
    {
        if (content == null)
        {
            return string.Empty;
        }

        if (content.Headers.ContentLength > MaxJsonBytes)
        {
            throw new SelvaApiException("Selva's answer was larger than the plugin accepts.");
        }

        using var stream = await content.ReadAsStreamAsync().ConfigureAwait(false);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, 0, chunk.Length).ConfigureAwait(false)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxJsonBytes)
            {
                throw new SelvaApiException("Selva's answer was larger than the plugin accepts.");
            }
        }

        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static JObject? ParseObject(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        // Dates stay strings: Newtonsoft would otherwise turn an ISO timestamp into a local DateTime.
        using var reader = new JsonTextReader(new StringReader(body))
        {
            DateParseHandling = DateParseHandling.None,
            MaxDepth = 64
        };
        try
        {
            return JObject.Load(reader);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? StringOf(JToken? token)
    {
        return token?.Type == JTokenType.String ? (string?)token : null;
    }
}
