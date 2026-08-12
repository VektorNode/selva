using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.GH.Config;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.UIBuilder.Services.Communication;

/// <summary>
///     Embedded HTTP server that serves static web assets from assembly resources, so the
///     production build has no external dependency for the web UI.
///
///     Built on raw <see cref="TcpListener" /> rather than <c>HttpListener</c>: HttpListener
///     depends on the Windows-only Http.sys driver and throws PlatformNotSupportedException on
///     macOS and Linux. Only GET and HEAD are implemented — the embedded UI never needs anything else.
/// </summary>
public class LocalWebServer : IDisposable
{
    private const int BUFFER_SIZE = AppConfig.HttpServer.BufferSizeBytes;
    private const string EMBEDDED_RESOURCE_PREFIX = AppConfig.HttpServer.EmbeddedResourcePrefix;

    private readonly Assembly _assembly;
    private readonly object _lock = new object();

    private readonly Dictionary<string, string> _mimeTypes = new Dictionary<string, string>
    {
        { ".html", "text/html; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" },
        { ".svg", "image/svg+xml" },
        { ".ico", "image/x-icon" },
        { ".woff", "font/woff" },
        { ".woff2", "font/woff2" },
        { ".ttf", "font/ttf" },
        { ".eot", "application/vnd.ms-fontobject" },
        { ".txt", "text/plain; charset=utf-8" }
    };

    private readonly HashSet<string> _resourceNames;

    private CancellationTokenSource _cancellationTokenSource;
    private bool _disposed;
    private TcpListener _tcpListener;

    public LocalWebServer(int port = 0)
    {
        Port = port;
        _assembly = Assembly.GetExecutingAssembly();
        _resourceNames = new HashSet<string>(_assembly.GetManifestResourceNames());
    }

    public bool IsRunning { get; private set; }
    public int Port { get; private set; }
    public string BaseUrl => $"http://localhost:{Port}";

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        Stop();
        _cancellationTokenSource?.Dispose();
        GC.SuppressFinalize(this);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Starts the server. Port 0 means the OS assigns a free port.
    /// </summary>
    public void Start()
    {
        if (IsRunning)
        {
            return;
        }

        lock (_lock)
        {
            if (IsRunning)
            {
                return;
            }

            if (Port == 0)
            {
                Port = FindAvailablePort();
            }

            _cancellationTokenSource = new CancellationTokenSource();
            _tcpListener = new TcpListener(IPAddress.Loopback, Port);

            try
            {
                _tcpListener.Start();
                Port = ((IPEndPoint)_tcpListener.LocalEndpoint).Port;
                IsRunning = true;
                _ = Task.Run(
                    () => AcceptRequestsAsync(_cancellationTokenSource.Token),
                    _cancellationTokenSource.Token);
            }
            catch (Exception ex)
            {
                // Clean up so Stop() has nothing to do.
                try { _tcpListener.Stop(); } catch { /* ignore */ }
                _tcpListener = null;
                throw new InvalidOperationException(
                    $"Failed to start HTTP server on port {Port}: {ex.Message}", ex);
            }
        }
    }

    public void Stop()
    {
        if (!IsRunning)
        {
            return;
        }

        lock (_lock)
        {
            if (!IsRunning)
            {
                return;
            }

            // Cancel first, then stop the listener, so AcceptTcpClientAsync() throws
            // and the accept loop exits instead of looping on a dead listener.
            _cancellationTokenSource?.Cancel();

            try
            {
                _tcpListener?.Stop();
            }
            catch (Exception ex)
            {
                Logger.Error($"Error stopping HTTP server: {ex.Message}");
            }
            finally
            {
                _tcpListener = null;
                IsRunning = false;
            }
        }
    }

    ~LocalWebServer()
    {
        Dispose();
    }

    // -------------------------------------------------------------------------
    // Request handling
    // -------------------------------------------------------------------------

    private async Task AcceptRequestsAsync(CancellationToken cancellationToken)
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
                Logger.Warn($"HTTP listener stopped: {ex.Message}");
                break;
            }
            catch (Exception ex)
            {
                Logger.Error($"Error accepting HTTP request: {ex.Message}");
                continue;
            }

            _ = Task.Run(
                () => ProcessRequestAsync(tcpClient, cancellationToken),
                cancellationToken);
        }
    }

    private async Task ProcessRequestAsync(TcpClient tcpClient, CancellationToken cancellationToken)
    {
        try
        {
            using (tcpClient)
            using (var stream = tcpClient.GetStream())
            {
                HttpRequest request;
                try
                {
                    request = await HttpRequestParser.ReadAsync(stream, cancellationToken).ConfigureAwait(false);
                }
                catch (InvalidDataException ex)
                {
                    await WriteResponseAsync(stream, 400, "Bad Request", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes(ex.Message), false, cancellationToken: cancellationToken)
                        .ConfigureAwait(false);
                    return;
                }

                if (request.Method != "GET" && request.Method != "HEAD")
                {
                    var allow = new Dictionary<string, string> { { "Allow", "GET, HEAD" } };
                    await WriteResponseAsync(stream, 405, "Method Not Allowed", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("405 - Method Not Allowed"), false, allow, cancellationToken)
                        .ConfigureAwait(false);
                    return;
                }

                var path = request.Target;
                var queryStart = path.IndexOf('?');
                if (queryStart >= 0)
                {
                    path = path.Substring(0, queryStart);
                }

                path = path.TrimStart('/');
                if (string.IsNullOrEmpty(path))
                {
                    path = "index.html";
                }

                // Content-addressed texture assets from TextureAssetStore. CORS is wide open because
                // the UI origin (Vite :5173 in dev, this server in production) is always cross-origin
                // to whichever server the browser loaded from, and WebGL needs CORS-clean images.
                // Hash-keyed URLs are immutable, so the browser can cache them forever.
                if (path.StartsWith("assets/", StringComparison.Ordinal))
                {
                    var hash = path.Substring("assets/".Length);
                    if (Features.Display.Services.TextureAssetStore.TryGet(hash, out var assetBytes, out var assetMime))
                    {
                        var assetHeaders = new Dictionary<string, string>
                        {
                            { "Cache-Control", "public, max-age=31536000, immutable" },
                            { "Access-Control-Allow-Origin", "*" }
                        };
                        await WriteResponseAsync(stream, 200, "OK", assetMime, assetBytes,
                            request.Method == "HEAD", assetHeaders, cancellationToken).ConfigureAwait(false);
                    }
                    else
                    {
                        await WriteResponseAsync(stream, 404, "Not Found", "text/plain; charset=utf-8",
                            Encoding.UTF8.GetBytes("404 - Not Found"), false,
                            cancellationToken: cancellationToken).ConfigureAwait(false);
                    }

                    return;
                }

                // SPA fallback: non-file routes (no extension) fall back to index.html.
                var resourcePath = GetResourcePath(path);
                if (!ResourceExists(resourcePath) && !path.Contains("."))
                {
                    path = "index.html";
                    resourcePath = GetResourcePath(path);
                }

                if (!ResourceExists(resourcePath))
                {
                    await WriteResponseAsync(stream, 404, "Not Found", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("404 - Not Found"), false, cancellationToken: cancellationToken)
                        .ConfigureAwait(false);
                    return;
                }

                if (!_mimeTypes.TryGetValue(
                        Path.GetExtension(path).ToLowerInvariant(),
                        out var mimeType))
                {
                    mimeType = "application/octet-stream";
                }

                // index.html must never be cached; hashed assets can be cached forever.
                var isImmutableAsset = path != "index.html" && path.Contains(".");
                var cacheControl = isImmutableAsset
                    ? "public, max-age=31536000, immutable"
                    : "no-cache, no-store, must-revalidate";

                var headers = new Dictionary<string, string>
                {
                    { "Cache-Control", cacheControl }
                };
                if (!isImmutableAsset)
                {
                    headers["Pragma"] = "no-cache";
                    headers["Expires"] = "0";
                }

                using var resourceStream = _assembly.GetManifestResourceStream(resourcePath);
                if (resourceStream == null)
                {
                    await WriteResponseAsync(stream, 404, "Not Found", "text/plain; charset=utf-8",
                        Encoding.UTF8.GetBytes("404 - Not Found"), false, cancellationToken: cancellationToken)
                        .ConfigureAwait(false);
                    return;
                }

                await WriteResponseHeadersAsync(stream, 200, "OK", mimeType, resourceStream.Length,
                    headers, cancellationToken).ConfigureAwait(false);

                // HEAD: headers only, no body.
                if (request.Method != "HEAD")
                {
                    await resourceStream.CopyToAsync(stream, BUFFER_SIZE, cancellationToken)
                        .ConfigureAwait(false);
                }

                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (IsClientDisconnect(ex))
        {
            // Browser closed the socket mid-response (reload/navigation/prefetch cancel) — routine, not a fault.
            Logger.Log($"Client disconnected during HTTP request: {ex.Message}");
        }
        catch (Exception ex)
        {
            Logger.Error($"Error processing HTTP request: {ex.Message}");
        }
    }

    /// <summary>
    ///     True for a client-side disconnect (socket aborted/reset, or request canceled)
    ///     rather than a genuine server fault.
    /// </summary>
    private static bool IsClientDisconnect(Exception ex)
    {
        switch (ex)
        {
            case OperationCanceledException _:
                return true;
            case SocketException socketEx:
                return socketEx.SocketErrorCode == SocketError.ConnectionAborted
                       || socketEx.SocketErrorCode == SocketError.ConnectionReset
                       || socketEx.SocketErrorCode == SocketError.Shutdown;
            case IOException ioEx when ioEx.InnerException != null:
                return IsClientDisconnect(ioEx.InnerException);
            default:
                return false;
        }
    }

    /// <summary>
    ///     Writes status line, headers, and optional body. <paramref name="extraHeaders" /> lets
    ///     callers add response-specific headers (e.g. Allow on 405).
    /// </summary>
    private static async Task WriteResponseAsync(
        Stream stream,
        int statusCode,
        string statusText,
        string contentType,
        byte[] body,
        bool isHead,
        IDictionary<string, string> extraHeaders = null,
        CancellationToken cancellationToken = default)
    {
        await WriteResponseHeadersAsync(
            stream, statusCode, statusText, contentType,
            body?.LongLength ?? 0, extraHeaders, cancellationToken).ConfigureAwait(false);

        if (!isHead && body != null && body.Length > 0)
        {
            await stream.WriteAsync(body, 0, body.Length, cancellationToken).ConfigureAwait(false);
        }

        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task WriteResponseHeadersAsync(
        Stream stream,
        int statusCode,
        string statusText,
        string contentType,
        long contentLength,
        IDictionary<string, string> extraHeaders,
        CancellationToken cancellationToken)
    {
        var sb = new StringBuilder();
        sb.Append("HTTP/1.1 ").Append(statusCode).Append(' ').Append(statusText).Append("\r\n");
        sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
        sb.Append("Content-Length: ").Append(contentLength).Append("\r\n");
        sb.Append("Connection: close\r\n");

        if (extraHeaders != null)
        {
            foreach (var kv in extraHeaders)
            {
                sb.Append(kv.Key).Append(": ").Append(kv.Value).Append("\r\n");
            }
        }

        sb.Append("\r\n");

        var bytes = Encoding.ASCII.GetBytes(sb.ToString());
        await stream.WriteAsync(bytes, 0, bytes.Length, cancellationToken).ConfigureAwait(false);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private string GetResourcePath(string urlPath)
    {
        return EMBEDDED_RESOURCE_PREFIX + urlPath;
    }

    private bool ResourceExists(string resourcePath)
    {
        return _resourceNames.Contains(resourcePath);
    }

    /// <summary>
    ///     Binds to port 0 so the OS assigns a free port — avoids a check-then-bind race.
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
}
