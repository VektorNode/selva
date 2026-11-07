using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using Selva.GH.Features.FileIO.Services;
using DrawImageFormat = Selva.Drawing.Model.Elements.ImageFormat;

namespace Selva.Tests;

// System.Drawing needs GDI+, so the decode tests only run on Windows; on the Linux CI runner
// the platform test runs instead.
public class RasterSanitizerTests
{
    private static byte[] Encode(ImageFormat format)
    {
        using var bitmap = new Bitmap(8, 8, PixelFormat.Format32bppArgb);
        bitmap.SetPixel(3, 3, Color.FromArgb(128, 255, 0, 0));
        using var ms = new MemoryStream();
        bitmap.Save(ms, format);
        return ms.ToArray();
    }

    [WindowsFact]
    public void Png_and_jpeg_come_back_reencoded_in_their_own_format()
    {
        Assert.Equal(SanitizeResult.Ok, RasterSanitizer.TryReencode(Encode(ImageFormat.Png), DrawImageFormat.Png, out var png));
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png[..4]);

        Assert.Equal(SanitizeResult.Ok, RasterSanitizer.TryReencode(Encode(ImageFormat.Jpeg), DrawImageFormat.Jpeg, out var jpeg));
        Assert.Equal(new byte[] { 0xFF, 0xD8, 0xFF }, jpeg[..3]);
    }

    [WindowsFact]
    public void Corrupt_data_and_webp_are_refused()
    {
        var truncated = Encode(ImageFormat.Png)[..40];
        Assert.Equal(SanitizeResult.Undecodable, RasterSanitizer.TryReencode(truncated, DrawImageFormat.Png, out _));
        Assert.Equal(SanitizeResult.Undecodable, RasterSanitizer.TryReencode("RIFF\0\0\0\0WEBPVP8 "u8.ToArray(), DrawImageFormat.Webp, out _));
    }

    [NotWindowsFact]
    public void Missing_system_drawing_is_reported_as_platform_not_image()
    {
        var pngSignature = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        Assert.Equal(SanitizeResult.PlatformUnsupported, RasterSanitizer.TryReencode(pngSignature, DrawImageFormat.Png, out _));
    }
}
