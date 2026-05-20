#nullable enable
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Minimal HTTP/1.1 request reader for our embedded servers. Reads the request
///     line and headers, leaving any body on the stream for the caller. We do not
///     implement keep-alive, chunked transfer, or multipart — the embedded servers
///     only need to handle simple GET/HEAD/WebSocket-upgrade requests from the local UI.
/// </summary>
internal sealed class HttpRequest
{
    public string Method { get; }
    public string Target { get; }
    public string HttpVersion { get; }

    /// <summary>
    ///     Headers, keyed case-insensitively per RFC 7230. Repeated header names are
    ///     joined with ", " in arrival order (RFC 7230 §3.2.2).
    /// </summary>
    public IReadOnlyDictionary<string, string> Headers { get; }

    public HttpRequest(string method, string target, string httpVersion, IReadOnlyDictionary<string, string> headers)
    {
        Method = method;
        Target = target;
        HttpVersion = httpVersion;
        Headers = headers;
    }

    public string? GetHeader(string name)
    {
        return Headers.TryGetValue(name, out var value) ? value : null;
    }
}

internal static class HttpRequestParser
{
    // Bound the request size so a misbehaving client can't make us read forever.
    private const int MaxRequestLineBytes = 8 * 1024;
    private const int MaxHeaderBytes = 16 * 1024;
    private const int MaxHeaderCount = 100;

    public static async Task<HttpRequest> ReadAsync(Stream stream, CancellationToken cancellationToken)
    {
        var requestLine = await ReadLineAsync(stream, MaxRequestLineBytes, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidDataException("Connection closed before request line was received.");

        var (method, target, version) = ParseRequestLine(requestLine);

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var totalHeaderBytes = 0;

        while (true)
        {
            var line = await ReadLineAsync(stream, MaxHeaderBytes, cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidDataException("Connection closed before headers terminator was received.");

            if (line.Length == 0)
            {
                break;
            }

            totalHeaderBytes += line.Length;
            if (totalHeaderBytes > MaxHeaderBytes || headers.Count >= MaxHeaderCount)
            {
                throw new InvalidDataException("Request headers exceeded allowed size.");
            }

            var colon = line.IndexOf(':');
            if (colon <= 0)
            {
                throw new InvalidDataException("Malformed header line: missing ':'.");
            }

            var name = line.Substring(0, colon).Trim();
            var value = line.Substring(colon + 1).Trim();

            // RFC 7230 §3.2.2: combine repeats with ", ". Order is preserved because we
            // iterate the stream in order; later values append to earlier ones.
            if (headers.TryGetValue(name, out var existing))
            {
                headers[name] = existing + ", " + value;
            }
            else
            {
                headers[name] = value;
            }
        }

        return new HttpRequest(method, target, version, headers);
    }

    internal static (string method, string target, string version) ParseRequestLine(string line)
    {
        // Spec: METHOD SP TARGET SP HTTP-VERSION. Exactly two SPs, no leading/trailing whitespace.
        var firstSp = line.IndexOf(' ');
        var lastSp = line.LastIndexOf(' ');
        if (firstSp <= 0 || lastSp <= firstSp)
        {
            throw new InvalidDataException("Malformed HTTP request line.");
        }

        var method = line.Substring(0, firstSp);
        var target = line.Substring(firstSp + 1, lastSp - firstSp - 1);
        var version = line.Substring(lastSp + 1);

        if (!version.StartsWith("HTTP/", StringComparison.Ordinal))
        {
            throw new InvalidDataException("Unsupported HTTP protocol identifier.");
        }

        return (method, target, version);
    }

    /// <summary>
    ///     Reads a single CRLF-terminated line. Returns null on EOF. The returned string
    ///     does not include the trailing CRLF.
    /// </summary>
    private static async Task<string?> ReadLineAsync(Stream stream, int maxBytes, CancellationToken cancellationToken)
    {
        var buffer = new byte[1];
        var sb = new StringBuilder(128);
        var sawCr = false;
        var bytesRead = 0;

        while (true)
        {
            var n = await stream.ReadAsync(buffer, 0, 1, cancellationToken).ConfigureAwait(false);
            if (n == 0)
            {
                return sb.Length == 0 && !sawCr ? null : sb.ToString();
            }

            bytesRead++;
            if (bytesRead > maxBytes)
            {
                throw new InvalidDataException($"HTTP line exceeded {maxBytes} bytes.");
            }

            var c = (char)buffer[0];
            if (sawCr)
            {
                if (c == '\n')
                {
                    return sb.ToString();
                }

                // Bare CR is illegal in HTTP — treat as malformed.
                throw new InvalidDataException("Malformed HTTP line: CR not followed by LF.");
            }

            if (c == '\r')
            {
                sawCr = true;
                continue;
            }

            sb.Append(c);
        }
    }
}
