using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     RFC 6455 WebSocket opening handshake. We implement the server side: read the
///     client's GET request, validate the Upgrade headers, and emit the 101 response.
///     Once the handshake completes the caller hands the underlying stream to
///     <c>WebSocket.CreateFromStream(..., isServer: true, ...)</c> and the standard
///     .NET <c>WebSocket</c> APIs take over framing/messages.
///
///     Why we hand-roll this instead of using HttpListener.AcceptWebSocketAsync:
///     HttpListener's WebSocket support relies on a Windows-only kernel driver
///     (Http.sys / WebSocket.dll), so it throws PlatformNotSupportedException on
///     macOS and Linux. A raw-socket handshake works everywhere.
/// </summary>
internal static class WebSocketHandshake
{
    // RFC 6455 §1.3 — magic GUID concatenated with the client key before SHA1.
    private const string AcceptMagicGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    /// <summary>
    ///     Computes the Sec-WebSocket-Accept response value from the client's
    ///     Sec-WebSocket-Key. SHA1(key + GUID), base64-encoded.
    /// </summary>
    public static string ComputeAcceptKey(string clientKey)
    {
        if (clientKey == null)
        {
            throw new ArgumentNullException(nameof(clientKey));
        }

        var concatenated = clientKey + AcceptMagicGuid;
        var bytes = Encoding.ASCII.GetBytes(concatenated);

        using var sha1 = SHA1.Create();
        var hash = sha1.ComputeHash(bytes);
        return Convert.ToBase64String(hash);
    }

    /// <summary>
    ///     Validates that the request is a well-formed WebSocket upgrade and returns
    ///     the Sec-WebSocket-Key. Throws <see cref="HandshakeException"/> on any
    ///     spec violation so callers can respond with the appropriate HTTP error.
    /// </summary>
    public static string ValidateUpgradeRequest(HttpRequest request)
    {
        if (request == null)
        {
            throw new ArgumentNullException(nameof(request));
        }

        // RFC 6455 §4.1: must be GET, HTTP/1.1 or higher.
        if (!string.Equals(request.Method, "GET", StringComparison.Ordinal))
        {
            throw new HandshakeException(405, "Method Not Allowed", "WebSocket handshake requires GET.");
        }

        if (!IsHttp11OrHigher(request.HttpVersion))
        {
            throw new HandshakeException(505, "HTTP Version Not Supported", "WebSocket requires HTTP/1.1 or higher.");
        }

        // Header values are case-insensitive in the Upgrade/Connection tokens (RFC 7230 §3.2).
        // Connection MAY include other tokens (e.g. "keep-alive, Upgrade"); we must find Upgrade in the list.
        var upgrade = request.GetHeader("Upgrade");
        if (upgrade == null || !ContainsToken(upgrade, "websocket"))
        {
            throw new HandshakeException(400, "Bad Request", "Missing or invalid Upgrade header.");
        }

        var connection = request.GetHeader("Connection");
        if (connection == null || !ContainsToken(connection, "Upgrade"))
        {
            throw new HandshakeException(400, "Bad Request", "Missing or invalid Connection header.");
        }

        var version = request.GetHeader("Sec-WebSocket-Version");
        if (version == null || !ContainsToken(version, "13"))
        {
            // Per RFC 6455 §4.4 we should also send a Sec-WebSocket-Version header listing
            // the versions we support; the caller is responsible for that.
            throw new HandshakeException(426, "Upgrade Required", "Unsupported Sec-WebSocket-Version.");
        }

        var key = request.GetHeader("Sec-WebSocket-Key");
        if (string.IsNullOrEmpty(key))
        {
            throw new HandshakeException(400, "Bad Request", "Missing Sec-WebSocket-Key header.");
        }

        // RFC 6455 §4.1: the key must decode to exactly 16 bytes. We don't enforce that
        // strictly because some non-conformant clients pad differently, but we sanity-check length.
        if (key.Length < 16 || key.Length > 256)
        {
            throw new HandshakeException(400, "Bad Request", "Sec-WebSocket-Key has implausible length.");
        }

        return key;
    }

    /// <summary>
    ///     Writes the HTTP/1.1 101 Switching Protocols response. After this returns
    ///     the stream is positioned right at the start of the WebSocket frame stream
    ///     and must be passed to WebSocket.CreateFromStream.
    /// </summary>
    public static async Task WriteUpgradeResponseAsync(
        Stream stream,
        string acceptKey,
        CancellationToken cancellationToken)
    {
        if (stream == null) throw new ArgumentNullException(nameof(stream));
        if (acceptKey == null) throw new ArgumentNullException(nameof(acceptKey));

        var response =
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " + acceptKey + "\r\n" +
            "\r\n";

        var bytes = Encoding.ASCII.GetBytes(response);
        await stream.WriteAsync(bytes, 0, bytes.Length, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    ///     Writes a plain HTTP error response. Used when the upgrade request is malformed.
    ///     The connection is closed by the caller after this returns.
    /// </summary>
    public static async Task WriteErrorResponseAsync(
        Stream stream,
        int statusCode,
        string statusText,
        string body,
        CancellationToken cancellationToken)
    {
        var bodyBytes = Encoding.UTF8.GetBytes(body ?? string.Empty);
        var header =
            "HTTP/1.1 " + statusCode + " " + statusText + "\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "Content-Length: " + bodyBytes.Length + "\r\n" +
            "Connection: close\r\n";

        // 426 must advertise the WebSocket version we support (RFC 6455 §4.4).
        if (statusCode == 426)
        {
            header += "Sec-WebSocket-Version: 13\r\n";
        }

        header += "\r\n";

        var headerBytes = Encoding.ASCII.GetBytes(header);
        await stream.WriteAsync(headerBytes, 0, headerBytes.Length, cancellationToken).ConfigureAwait(false);
        if (bodyBytes.Length > 0)
        {
            await stream.WriteAsync(bodyBytes, 0, bodyBytes.Length, cancellationToken).ConfigureAwait(false);
        }

        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static bool IsHttp11OrHigher(string httpVersion)
    {
        // Accept HTTP/1.1, HTTP/2, HTTP/3. Reject HTTP/1.0 and earlier.
        if (string.IsNullOrEmpty(httpVersion) || !httpVersion.StartsWith("HTTP/", StringComparison.Ordinal))
        {
            return false;
        }

        var versionPart = httpVersion.Substring(5);
        var dot = versionPart.IndexOf('.');
        var majorStr = dot >= 0 ? versionPart.Substring(0, dot) : versionPart;
        if (!int.TryParse(majorStr, out var major))
        {
            return false;
        }

        if (major > 1)
        {
            return true;
        }

        if (major != 1 || dot < 0)
        {
            return false;
        }

        return int.TryParse(versionPart.Substring(dot + 1), out var minor) && minor >= 1;
    }

    /// <summary>
    ///     Case-insensitive search for a token in a comma-separated header value.
    ///     "keep-alive, Upgrade" contains "Upgrade"; "Upgrades" does not contain "Upgrade".
    /// </summary>
    internal static bool ContainsToken(string headerValue, string token)
    {
        if (string.IsNullOrEmpty(headerValue))
        {
            return false;
        }

        var parts = headerValue.Split(',');
        for (var i = 0; i < parts.Length; i++)
        {
            if (string.Equals(parts[i].Trim(), token, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}

internal sealed class HandshakeException : Exception
{
    public int StatusCode { get; }
    public string StatusText { get; }

    public HandshakeException(int statusCode, string statusText, string message) : base(message)
    {
        StatusCode = statusCode;
        StatusText = statusText;
    }
}
