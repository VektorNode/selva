using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Selva.Config;
using Selva.Core.Helpers;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Embedded HTTP server that serves static web assets from assembly resources.
///   Used in production to serve the web UI without external dependencies.
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
    // { ".hdr", "application/octet-stream" }, // HDR files for 3D viewer
    // { ".gh", "application/octet-stream" } // Grasshopper files
  };

  private readonly HashSet<string> _resourceNames;

  private CancellationTokenSource _cancellationTokenSource;
  private HttpListener _httpListener;

  public LocalWebServer(int port = 0)
  {
    Port = port;
    _assembly = Assembly.GetExecutingAssembly();

    // Cache resource names for fast lookup
    _resourceNames = new HashSet<string>(_assembly.GetManifestResourceNames());
  }

  public bool IsRunning { get; private set; }
  public int Port { get; private set; }
  public string BaseUrl => $"http://localhost:{Port}";

  public void Dispose()
  {
    Stop();
    _cancellationTokenSource?.Dispose();
    GC.SuppressFinalize(this);
  }

  ~LocalWebServer()
  {
    Dispose();
  }

  /// <summary>
  ///   Start the HTTP server on the specified port (or random port if 0)
  /// </summary>
  public void Start()
  {
    if (IsRunning) return;

    lock (_lock)
    {
      if (IsRunning) return;

      _cancellationTokenSource = new CancellationTokenSource();
      _httpListener = new HttpListener();

      // If port is 0, find a random available port
      if (Port == 0) Port = FindAvailablePort();

      _httpListener.Prefixes.Add($"http://localhost:{Port}/");

      try
      {
        _httpListener.Start();
        IsRunning = true;

        // Start accepting requests in background
        _ = Task.Run(async () => await AcceptRequestsAsync(_cancellationTokenSource.Token));
      }
      catch (Exception ex)
      {
        throw new Exception($"Failed to start HTTP server on port {Port}: {ex.Message}", ex);
      }
    }
  }

  /// <summary>
  ///   Stop the HTTP server
  /// </summary>
  public void Stop()
  {
    if (!IsRunning) return;

    lock (_lock)
    {
      if (!IsRunning) return;

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

  /// <summary>
  ///   Accept and process HTTP requests
  /// </summary>
  private async Task AcceptRequestsAsync(CancellationToken cancellationToken)
  {
    while (!cancellationToken.IsCancellationRequested && IsRunning)
      try
      {
        var context = await _httpListener.GetContextAsync();

        _ = Task.Run(() => ProcessRequestAsync(context, cancellationToken), cancellationToken);
      }
      catch (HttpListenerException ex)
      {
        Logger.Warn($"HTTP listener stopped: {ex.Message}");
        break;
      }
      catch (Exception ex)
      {
        Logger.Error($"Error accepting HTTP request: {ex.Message}");
      }
  }

  /// <summary>
  ///   Process a single HTTP request
  /// </summary>
  private async Task ProcessRequestAsync(HttpListenerContext context, CancellationToken cancellationToken)
  {
    try
    {
      var request = context.Request;
      var response = context.Response;

      var path = request.Url.AbsolutePath.TrimStart('/');

      // Default to index.html for root path
      if (string.IsNullOrEmpty(path)) path = "index.html";

      // SPA fallback: serve index.html for all routes that don't match files
      // This enables client-side routing (e.g., /builder?session=xxx)
      var resourcePath = GetResourcePath(path);
      if (!ResourceExists(resourcePath) && !path.Contains("."))
      {
        // Route doesn't exist and is not a file request -> serve index.html
        resourcePath = GetResourcePath("index.html");
        path = "index.html";
      }

      // Check if resource exists
      if (!ResourceExists(resourcePath))
      {
        await Send404Async(response, cancellationToken);
        return;
      }

      var extension = Path.GetExtension(path).ToLowerInvariant();
      var mimeType = _mimeTypes.ContainsKey(extension)
        ? _mimeTypes[extension]
        : "application/octet-stream";

      // Set response headers
      response.ContentType = mimeType;
      response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      response.AddHeader("Pragma", "no-cache");
      response.AddHeader("Expires", "0");

      // Load and send resource
      using (var stream = _assembly.GetManifestResourceStream(resourcePath))
      {
        if (stream == null)
        {
          await Send404Async(response, cancellationToken);
          return;
        }

        response.ContentLength64 = stream.Length;
        response.StatusCode = 200;

        await stream.CopyToAsync(response.OutputStream, BUFFER_SIZE, cancellationToken);
      }

      response.Close();
    }
    catch (Exception ex)
    {
      Logger.Error($"Error processing HTTP request for {context.Request.Url?.AbsolutePath}: {ex.Message}");

      try
      {
        context.Response.StatusCode = 500;
        context.Response.Close();
      }
      catch (Exception closeEx)
      {
        Logger.Error($"Error sending 500 response: {closeEx.Message}");
      }
    }
  }

  /// <summary>
  ///   Send a 404 Not Found response
  /// </summary>
  private async Task Send404Async(HttpListenerResponse response, CancellationToken cancellationToken)
  {
    response.StatusCode = 404;
    response.ContentType = "text/plain; charset=utf-8";

    var message = Encoding.UTF8.GetBytes("404 - Not Found");
    response.ContentLength64 = message.Length;

    await response.OutputStream.WriteAsync(message, 0, message.Length, cancellationToken);
    response.Close();
  }

  /// <summary>
  ///   Convert a URL path to an embedded resource path
  /// </summary>
  private string GetResourcePath(string urlPath)
  {
    // MSBuild is configured to use forward slashes for all platforms (see Selva.csproj)
    return EMBEDDED_RESOURCE_PREFIX + urlPath;
  }

  /// <summary>
  ///   Check if an embedded resource exists
  /// </summary>
  private bool ResourceExists(string resourcePath)
  {
    return _resourceNames.Contains(resourcePath);
  }

  /// <summary>
  ///   Find an available port by trying to bind to port 0 (OS assigns random port)
  /// </summary>
  private int FindAvailablePort()
  {
    var random = new Random();
    for (var i = 0; i < AppConfig.HttpServer.PortDiscoveryAttempts; i++)
    {
      var port = random.Next(AppConfig.HttpServer.PortRangeMin, AppConfig.HttpServer.PortRangeMax);

      try
      {
        using (var listener = new HttpListener())
        {
          listener.Prefixes.Add($"http://localhost:{port}/");
          listener.Start();
          listener.Stop();
          return port;
        }
      }
      catch (Exception)
      {
        // Port not available, try next
        Logger.Log($"Port {port} not available");
      }
    }

    return random.Next(AppConfig.HttpServer.PortRangeMax, AppConfig.HttpServer.PortRangeMax + 1000);
  }
}
