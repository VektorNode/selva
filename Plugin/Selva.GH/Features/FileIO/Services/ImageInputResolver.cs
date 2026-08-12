using System;
using System.IO;
using Selva.Drawing.Model.Elements;
using Selva.GH.Config;

namespace Selva.GH.Features.FileIO.Services;

// ============================================================================
// Resolves a FileInputData (path / url / base64) carrying an image into raw
// bytes plus the ImageFormat the drawing model expects. Url mode goes through
// FileImporter.DownloadUrlToTemp so it inherits the SSRF guard + size limits.
// ============================================================================
public static class ImageInputResolver
{
    private static readonly int MaxFileSizeBytes = AppConfig.ValueLimits.MaxFileSizeBytes;

    public static readonly string[] AcceptedFormats = { ".png", ".jpg", ".jpeg", ".webp", ".svg" };

    public static (bool Success, byte[] Data, ImageFormat Format, string ErrorMessage) Resolve(FileInputData fileData)
    {
        if (fileData == null || string.IsNullOrEmpty(fileData.File))
        {
            return (false, null, default, "No image data provided");
        }

        var ending = NormalizeExtension(fileData.FileEnding);
        if (ending == null && fileData.Type?.ToLowerInvariant() != "url")
        {
            ending = NormalizeExtension(Path.GetExtension(fileData.File));
        }

        switch (fileData.Type?.ToLowerInvariant())
        {
            case "base64":
                return ResolveBase64(fileData.File, ending);

            case "url":
                return ResolveUrl(fileData.File, fileData.FileEnding);

            default: // "path" or unspecified
                return ResolvePath(fileData.File, ending);
        }
    }

    private static (bool, byte[], ImageFormat, string) ResolveBase64(string base64, string ending)
    {
        if (!TryGetFormat(ending, out var format, out var formatError))
        {
            return (false, null, default, formatError);
        }

        if (base64.Length > MaxFileSizeBytes * 2) // base64 is ~1.37x larger than bytes
        {
            return (false, null, default, "Image data too large");
        }

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            return (false, null, default, "Invalid base64 image data");
        }

        if (bytes.Length > MaxFileSizeBytes)
        {
            return (false, null, default, SizeError(bytes.Length));
        }

        return (true, bytes, format, "");
    }

    private static (bool, byte[], ImageFormat, string) ResolvePath(string path, string ending)
    {
        if (!TryGetFormat(ending, out var format, out var formatError))
        {
            return (false, null, default, formatError);
        }

        if (!File.Exists(path))
        {
            return (false, null, default, $"Image file not found: {path}");
        }

        var info = new FileInfo(path);
        if (info.Length > MaxFileSizeBytes)
        {
            return (false, null, default, SizeError(info.Length));
        }

        try
        {
            return (true, File.ReadAllBytes(path), format, "");
        }
        catch (Exception ex)
        {
            return (false, null, default, $"Could not read image file: {ex.Message}");
        }
    }

    private static (bool, byte[], ImageFormat, string) ResolveUrl(string url, string fileEnding)
    {
        // Resolve the image extension before downloading so an unsupported format
        // fails fast instead of hitting the network first.
        var ending = NormalizeExtension(fileEnding);
        if (ending == null)
        {
            try { ending = NormalizeExtension(Path.GetExtension(new Uri(url).LocalPath)); }
            catch { /* fall through to the format check below */ }
        }

        if (!TryGetFormat(ending, out var format, out var formatError))
        {
            return (false, null, default, formatError);
        }

        var download = FileImporter.DownloadUrlToTemp(url, ending);
        if (!download.Success)
        {
            return (false, null, default, download.ErrorMessage);
        }

        try
        {
            return (true, File.ReadAllBytes(download.TempPath), format, "");
        }
        catch (Exception ex)
        {
            return (false, null, default, $"Could not read downloaded image: {ex.Message}");
        }
        finally
        {
            try { if (File.Exists(download.TempPath)) File.Delete(download.TempPath); }
            catch { /* ignore cleanup errors */ }
        }
    }

    private static bool TryGetFormat(string ending, out ImageFormat format, out string error)
    {
        format = default;
        switch (ending)
        {
            case ".png": format = ImageFormat.Png; break;
            case ".jpg":
            case ".jpeg": format = ImageFormat.Jpeg; break;
            case ".webp": format = ImageFormat.Webp; break;
            case ".svg": format = ImageFormat.Svg; break;
            default:
                error = $"Unsupported image format '{ending ?? "(none)"}'. Accepted: {string.Join(", ", AcceptedFormats)}";
                return false;
        }

        error = "";
        return true;
    }

    private static string NormalizeExtension(string ext) =>
        string.IsNullOrEmpty(ext) ? null : ext.ToLowerInvariant();

    private static string SizeError(long bytes) =>
        $"Image too large: {bytes / 1024 / 1024}MB (max {MaxFileSizeBytes / 1024 / 1024}MB)";
}
