using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Reflection;

namespace Selva.App;

/// <summary>
///     Selva's logo for windows: <c>selva.ico</c>, which <c>scripts/plugin/make-app-icon.mjs</c>
///     draws from the SVG at every size Windows asks for. Compiled into the app and its installer.
/// </summary>
internal static class AppIcon
{
    private const string ResourceName = "Selva.selva.ico";
    private const int LargestFrame = 256;

    /// <summary>
    ///     Every frame, so the title bar and the taskbar each get the size they need. The exe's
    ///     own icon read back through the shell would be one 32 px frame, scaled.
    /// </summary>
    public static Icon Load()
    {
        using var stream = Open();
        return new Icon(stream);
    }

    /// <summary>The logo at exactly <paramref name="pixels" />, for drawing inside a window.</summary>
    public static Bitmap Logo(int pixels)
    {
        using var stream = Open();
        using var icon = new Icon(stream, LargestFrame, LargestFrame);
        using var source = icon.ToBitmap();
        var logo = new Bitmap(pixels, pixels);
        using var graphics = Graphics.FromImage(logo);
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
        graphics.DrawImage(source, 0, 0, pixels, pixels);
        return logo;
    }

    private static System.IO.Stream Open()
    {
        return Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName)
               ?? throw new InvalidOperationException($"Missing resource {ResourceName}.");
    }
}
