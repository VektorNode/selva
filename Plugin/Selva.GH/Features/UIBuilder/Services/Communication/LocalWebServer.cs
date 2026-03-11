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
///     Embedded HTTP server that serves static web assets from assembly resources.
///     Used in production to serve the web UI without external dependencies.
/// </summary>
public class LocalWebServer : IDisposable
{
    private const int BUFFER_SIZE = AppConfig.HttpServer.BufferSizeBytes;
    private const string EMBEDDED_RESOURCE_PREFIX = AppConfig.HttpServer.EmbeddedResourcePrefix;

    private readonly Assembly _assembly;
    private readonly object _lock = new();

    private readonly Dictionary<string, string> _mimeTypes = new()
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
    private HttpListener _httpListener;

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
        if (_disposed) return;
        _disposed = true;

        Stop();
        _cancellationTokenSource?.Dispose();
        GC.SuppressFinalize(this);
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Start the HTTP server. If port was 0 the OS assigns a free port.
    /// </summary>
    public void Start()
    {
        if (IsRunning) return;

        lock (_lock)
        {
            if (IsRunning) return;

            // Resolve port before touching HttpListener so we never have a
            // TOCTOU window between "check free" and "bind".
            if (Port == 0)
                Port = FindAvailablePort();

            _cancellationTokenSource = new CancellationTokenSource();
            _httpListener = new HttpListener();
            _httpListener.Prefixes.Add($"http://localhost:{Port}/");

            try
            {
                _httpListener.Start();
                IsRunning = true;
                _ = Task.Run(
                    () => AcceptRequestsAsync(_cancellationTokenSource.Token),
                    _cancellationTokenSource.Token);
            }
            catch (Exception ex)
            {
                // Clean up the listener we just created so Stop() has nothing to do.
                _httpListener.Close();
                _httpListener = null;
                throw new InvalidOperationException(
                    $"Failed to start HTTP server on port {Port}: {ex.Message}", ex);
            }
        }
    }

    /// <summary>
    ///     Stop the HTTP server and wait for the accept loop to exit.
    /// </summary>
    public void Stop()
    {
        if (!IsRunning) return;

        lock (_lock)
        {
            if (!IsRunning) return;

            // Signal the accept loop first, then abort the listener so
            // GetContextAsync() throws and the loop exits cleanly.
            _cancellationTokenSource?.Cancel();

            try
            {
                _httpListener?.Stop();
                _httpListener?.Close();
            }
            catch (Exception ex)
            {
                Logger.Error($"Error stopping HTTP server: {ex.Message}");
            }
            finally
            {
                _httpListener = null;
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
            try
            {
                var context = await _httpListener.GetContextAsync().ConfigureAwait(false);
                _ = Task.Run(
                    () => ProcessRequestAsync(context, cancellationToken),
                    cancellationToken);
            }
            catch (HttpListenerException ex)
            {
                // Listener was stopped intentionally — not an error.
                Logger.Warn($"HTTP listener stopped: {ex.Message}");
                break;
            }
            catch (Exception ex)
            {
                Logger.Error($"Error accepting HTTP request: {ex.Message}");
            }
    }

    private async Task ProcessRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var response = context.Response;

        try
        {
            var request = context.Request;

            // Only GET and HEAD are meaningful for a static asset server.
            if (request.HttpMethod is not ("GET" or "HEAD"))
            {
                response.StatusCode = 405;
                response.AddHeader("Allow", "GET, HEAD");
                response.Close();
                return;
            }

            var path = request.Url.AbsolutePath.TrimStart('/');
            if (string.IsNullOrEmpty(path)) path = "index.html";

            // SPA fallback: non-file routes (no extension) fall back to index.html.
            var resourcePath = GetResourcePath(path);
            if (!ResourceExists(resourcePath) && !path.Contains("."))
            {
                path = "index.html";
                resourcePath = GetResourcePath(path);
            }

            if (!ResourceExists(resourcePath))
            {
                await Send404Async(response, cancellationToken).ConfigureAwait(false);
                return;
            }

            if (!_mimeTypes.TryGetValue(
                    Path.GetExtension(path).ToLowerInvariant(),
                    out var mimeType))
                mimeType = "application/octet-stream";

            // index.html must never be cached; hashed assets can be cached forever.
            var isImmutableAsset = path != "index.html" && path.Contains(".");
            var cacheControl = isImmutableAsset
                ? "public, max-age=31536000, immutable"
                : "no-cache, no-store, must-revalidate";

            response.ContentType = mimeType;
            response.AddHeader("Cache-Control", cacheControl);
            if (!isImmutableAsset)
            {
                response.AddHeader("Pragma", "no-cache");
                response.AddHeader("Expires", "0");
            }

            using var stream = _assembly.GetManifestResourceStream(resourcePath);
            if (stream == null)
            {
                await Send404Async(response, cancellationToken).ConfigureAwait(false);
                return;
            }

            response.ContentLength64 = stream.Length;
            response.StatusCode = 200;

            // HEAD: headers only, no body.
            if (request.HttpMethod != "HEAD")
                await stream.CopyToAsync(response.OutputStream, BUFFER_SIZE, cancellationToken)
                    .ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Logger.Error(
                $"Error processing HTTP request for {context.Request.Url?.AbsolutePath}: {ex.Message}");

            try
            {
                response.StatusCode = 500;
            }
            catch
            {
                /* headers already sent */
            }
        }
        finally
        {
            // Always close the response, whether success, 4xx, or 5xx.
            try
            {
                response.Close();
            }
            catch
            {
                /* ignore */
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private async Task Send404Async(HttpListenerResponse response, CancellationToken cancellationToken)
    {
        response.StatusCode = 404;
        response.ContentType = "text/plain; charset=utf-8";

        var message = Encoding.UTF8.GetBytes("404 - Not Found");
        response.ContentLength64 = message.Length;

        await response.OutputStream
            .WriteAsync(message, 0, message.Length, cancellationToken)
            .ConfigureAwait(false);
    }

    private string GetResourcePath(string urlPath)
    {
        return EMBEDDED_RESOURCE_PREFIX + urlPath;
    }

    private bool ResourceExists(string resourcePath)
    {
        return _resourceNames.Contains(resourcePath);
    }

    /// <summary>
    ///     Ask the OS for a free port by binding to port 0 — no TOCTOU race.
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
