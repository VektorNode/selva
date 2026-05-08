using System.Drawing;
using System.Drawing.Drawing2D;

namespace Selva.GH.Features.ComputeIO.Components;

public static class Utils
{
    public static Bitmap ContextualiseIcon(Bitmap bitmap)
    {
        var bitmap1 = (Bitmap)bitmap.Clone();
        using (var graphics = Graphics.FromImage(bitmap1))
        {
            graphics.SmoothingMode = SmoothingMode.None;
            graphics.PixelOffsetMode = PixelOffsetMode.None;
            graphics.FillRectangle(Brushes.Purple, 0, 16 /*0x10*/, 24, 7);
        }

        var white = Color.White;
        for (var x = 1; x < 9; ++x)
        {
            bitmap1.SetPixel(x, 17, white);
            bitmap1.SetPixel(x, 19, white);
            bitmap1.SetPixel(x, 21, white);
        }

        for (var x = 11; x < 22; x += 2)
        {
            bitmap1.SetPixel(x, 21, white);
        }

        bitmap1.SetPixel(11, 17, white);
        bitmap1.SetPixel(13, 17, white);
        bitmap1.SetPixel(12, 18, white);
        bitmap1.SetPixel(12, 19, white);
        bitmap1.SetPixel(12, 20, white);
        return bitmap1;
    }
}
