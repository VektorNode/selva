using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Utilities.Guards;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Turns a Three Material texture input (bitmap, image URL, or file path) into the reference
///     string a <see cref="Selva.Slva.ThreeMaterial" /> map carries.
/// </summary>
public static class TextureInput
{
    // Past this size, a data-URI texture (the headless fallback) re-ships enough base64 per solve
    // to hurt — warn so the user knows to host the image instead.
    private const int DataUriWarnBytes = 2 * 1024 * 1024;

    /// <summary>
    ///     http(s)/data URLs pass through untouched. Bitmaps and local files are content-hashed and
    ///     served from the plugin's asset endpoint, so re-solves never re-ship image bytes. Returns
    ///     null for no input, and warns on <paramref name="owner" /> for input it can't use.
    /// </summary>
    public static string Resolve(IGH_Goo goo, GH_ActiveObject owner)
    {
        if (goo == null)
        {
            return null;
        }

        var value = goo.ScriptVariable();
        switch (value)
        {
            case Bitmap bitmap:
            {
                using (var ms = new MemoryStream())
                {
                    bitmap.Save(ms, ImageFormat.Png);
                    return Publish(ms.ToArray(), "image/png", owner);
                }
            }
            case string s when !string.IsNullOrWhiteSpace(s):
            {
                var trimmed = s.Trim();
                if (trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
                    || trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    return trimmed;
                }

                if (!File.Exists(trimmed))
                {
                    owner.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                        $"Texture file not found: {trimmed}");
                    return null;
                }

                return Publish(File.ReadAllBytes(trimmed), MimeFromExtension(trimmed), owner);
            }
            default:
                owner.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Texture input must be a bitmap, an image URL, or an image file path");
                return null;
        }
    }

    // Headless (Rhino.Compute) has no asset server to serve from, so the bytes go inline.
    private static string Publish(byte[] bytes, string mime, GH_ActiveObject owner)
    {
        if (HeadlessGuard.IsHeadless)
        {
            if (bytes.Length > DataUriWarnBytes)
            {
                owner.AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Texture is {bytes.Length / (1024 * 1024)} MB and is embedded inline in headless mode — "
                    + "host it at a URL to avoid re-sending it on every solve");
            }

            return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
        }

        return TextureAssetStore.Register(bytes, mime);
    }

    private static string MimeFromExtension(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".png": return "image/png";
            case ".jpg":
            case ".jpeg": return "image/jpeg";
            case ".webp": return "image/webp";
            case ".gif": return "image/gif";
            case ".svg": return "image/svg+xml";
            case ".bmp": return "image/bmp";
            default: return "application/octet-stream";
        }
    }
}
