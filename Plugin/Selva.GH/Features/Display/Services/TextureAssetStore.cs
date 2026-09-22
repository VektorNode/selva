using System;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Process-wide content-addressed registry for material texture bytes, served over HTTP at
///     <c>/assets/{hash}</c> by <see cref="LocalWebServer" />.
///
///     <c>GH_ThreeMaterial</c> registers bytes and gets back a hash-keyed URL for <see cref="ThreeMaterial.Map" />:
///     since the URL is derived from content, the browser caches it forever, and re-solves only ship
///     the URL string, never the image bytes again.
///
///     Static so any <see cref="LocalWebServer" /> in the process can serve it. The UIBuilder's
///     embedded server is production-only and per-component, so a dedicated server starts lazily on
///     first registration: in dev mode that's the only HTTP server in the plugin.
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

    /// <summary>Registers texture bytes, starting the asset server on first use, and returns the asset URL.</summary>
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
