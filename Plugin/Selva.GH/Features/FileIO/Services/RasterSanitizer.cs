using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using DrawImageFormat = Selva.Drawing.Model.Elements.ImageFormat;

namespace Selva.GH.Features.FileIO.Services;

public enum SanitizeResult
{
    Ok,
    Undecodable,
    PlatformUnsupported,
}

// ============================================================================
// Decodes a user-supplied PNG or JPEG with System.Drawing and re-encodes it, so
// the PDF library only ever parses bytes this encoder wrote. PDFsharp is pinned
// to its last MIT release and gets no security fixes; System.Drawing is GDI+ on
// Windows and Rhino's own implementation on Mac, both patched by their vendors.
// ============================================================================
public static class RasterSanitizer
{
    // High enough that a re-encoded photo shows no visible loss next to the original.
    private const long JpegQuality = 92;

    public static SanitizeResult TryReencode(byte[] data, DrawImageFormat format, out byte[] clean)
    {
        clean = null;
        if (data == null || data.Length == 0) return SanitizeResult.Undecodable;
        if (format != DrawImageFormat.Png && format != DrawImageFormat.Jpeg) return SanitizeResult.Undecodable;

        try
        {
            clean = Reencode(data, format);
            return SanitizeResult.Ok;
        }
        catch (Exception ex) when (ex is PlatformNotSupportedException
                                       or TypeInitializationException
                                       or TypeLoadException
                                       or FileNotFoundException
                                       or FileLoadException
                                       or MissingMethodException
                                       or DllNotFoundException)
        {
            // System.Drawing itself is missing or unusable on this host; the image may be fine.
            return SanitizeResult.PlatformUnsupported;
        }
        catch (Exception)
        {
            // Corrupt, truncated or hostile data: GDI+ throws ArgumentException,
            // ExternalException or OutOfMemoryException depending on what is wrong.
            return SanitizeResult.Undecodable;
        }
    }

    // Separate and never inlined: a System.Drawing assembly-load failure surfaces when this
    // method is JIT-compiled, which must happen inside TryReencode's try, not at its call site.
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static byte[] Reencode(byte[] data, DrawImageFormat format)
    {
        // Bitmap reads lazily from the stream, so it must outlive the bitmap.
        using var input = new MemoryStream(data, writable: false);
        using var bitmap = new Bitmap(input);
        using var output = new MemoryStream();

        if (format == DrawImageFormat.Png)
        {
            bitmap.Save(output, ImageFormat.Png);
        }
        else
        {
            var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(Encoder.Quality, JpegQuality);
            bitmap.Save(output, codec, parameters);
        }

        return output.ToArray();
    }
}
