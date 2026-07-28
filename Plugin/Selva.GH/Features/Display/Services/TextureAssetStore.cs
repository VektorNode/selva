using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Process-wide content-addressed registry for material texture bytes, served over HTTP at
///     <c>/assets/{hash}</c> by <see cref="LocalWebServer" />.
///
///     Textures are registered by <c>GH_ThreeMaterial</c> (bitmap input or local file path) and
///     referenced from <see cref="ThreeMaterial.Map" /> by an immutable, hash-keyed URL. Because
///     the URL is derived from the content, the browser caches each texture forever and re-solves
///     never re-ship image bytes — only the tiny URL string travels with the material.
///
///     The registry is static so ANY LocalWebServer instance in the process can serve it. The
///     UIBuilder's embedded server only runs in production (and is per-component), so a dedicated
///     server is started lazily on first registration — in dev mode that is the only HTTP server
///     in the plugin. Entries live for the Rhino session; re-registering the same bytes is a no-op
///     (same hash).
/// </summary>
public static class TextureAssetStore
{
    private sealed class Asset
    {
        public byte[] Bytes;
        public string Mime;
    }

    private static readonly ConcurrentDictionary<string, Asset> Assets =
        new ConcurrentDictionary<string, Asset>(StringComparer.Ordinal);

    private static readonly object ServerLock = new object();
    private static LocalWebServer _server;

    /// <summary>
    ///     Registers texture bytes and returns the absolute asset URL
    ///     (<c>http://localhost:{port}/assets/{hash}</c>), starting the asset server on first use.
    /// </summary>
    public static string Register(byte[] bytes, string mime)
    {
        if (bytes == null || bytes.Length == 0)
        {
            throw new ArgumentException("Texture bytes must not be empty", nameof(bytes));
        }

        var hash = ComputeHash(bytes);
        Assets.TryAdd(hash, new Asset { Bytes = bytes, Mime = mime ?? "application/octet-stream" });

        var server = EnsureServer();
        return $"{server.BaseUrl}/assets/{hash}";
    }

    /// <summary>Looks up a registered asset by hash. Called from the HTTP request path.</summary>
    public static bool TryGet(string hash, out byte[] bytes, out string mime)
    {
        if (!string.IsNullOrEmpty(hash) && Assets.TryGetValue(hash, out var asset))
        {
            bytes = asset.Bytes;
            mime = asset.Mime;
            return true;
        }

        bytes = null;
        mime = null;
        return false;
    }

    private static LocalWebServer EnsureServer()
    {
        if (_server != null && _server.IsRunning)
        {
            return _server;
        }

        lock (ServerLock)
        {
            if (_server == null)
            {
                _server = new LocalWebServer();
            }

            if (!_server.IsRunning)
            {
                _server.Start();
            }

            return _server;
        }
    }

    private static string ComputeHash(byte[] bytes)
    {
        using (var sha = SHA256.Create())
        {
            var digest = sha.ComputeHash(bytes);

            // 32 hex chars (128 bits) is plenty for content addressing and keeps URLs short.
            var sb = new System.Text.StringBuilder(32);
            for (var i = 0; i < 16; i++)
            {
                sb.Append(digest[i].ToString("x2"));
            }

            return sb.ToString();
        }
    }
}
