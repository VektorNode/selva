using System;
using System.Globalization;
using System.Text;
using Selva.Drawing.Model.Elements;

namespace Selva.GH.Features.FileIO.Services;

// ============================================================================
// Reads intrinsic pixel (or, for SVG, user-unit) dimensions straight from image
// file headers — no full decode, no System.Drawing / ImageSharp dependency, so
// it stays cross-platform (Compute on Linux). Used to auto-size or aspect-fit
// images in Draw Image. Returns false when the header can't be parsed; callers
// then require explicit Width + Height.
// ============================================================================
public static class ImageDimensions
{
    public static bool TryGet(byte[] data, ImageFormat format, out double width, out double height)
    {
        width = 0;
        height = 0;
        if (data == null || data.Length < 8) return false;

        try
        {
            switch (format)
            {
                case ImageFormat.Png: return TryPng(data, out width, out height);
                case ImageFormat.Jpeg: return TryJpeg(data, out width, out height);
                case ImageFormat.Webp: return TryWebp(data, out width, out height);
                case ImageFormat.Svg: return TrySvg(data, out width, out height);
                default: return false;
            }
        }
        catch
        {
            return false;
        }
    }

    private static bool TryPng(byte[] d, out double w, out double h)
    {
        w = 0; h = 0;
        // PNG signature (8 bytes) + IHDR length(4) + "IHDR"(4); width/height are the next
        // two big-endian uint32s at offsets 16 and 20.
        if (d.Length < 24) return false;
        if (d[0] != 0x89 || d[1] != 0x50 || d[2] != 0x4E || d[3] != 0x47) return false;
        w = ReadUInt32Be(d, 16);
        h = ReadUInt32Be(d, 20);
        return w > 0 && h > 0;
    }

    private static bool TryJpeg(byte[] d, out double w, out double h)
    {
        w = 0; h = 0;
        if (d[0] != 0xFF || d[1] != 0xD8) return false; // SOI

        var i = 2;
        while (i + 9 < d.Length)
        {
            if (d[i] != 0xFF) { i++; continue; }

            var marker = d[i + 1];
            // Standalone markers with no length payload.
            if (marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7))
            {
                i += 2;
                continue;
            }

            var segLen = (d[i + 2] << 8) | d[i + 3];
            if (segLen < 2) return false;

            // SOF markers carry the frame dimensions (skip non-baseline-irrelevant ones).
            var isSof = (marker >= 0xC0 && marker <= 0xCF)
                        && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
            if (isSof && i + 9 < d.Length)
            {
                h = (d[i + 5] << 8) | d[i + 6];
                w = (d[i + 7] << 8) | d[i + 8];
                return w > 0 && h > 0;
            }

            i += 2 + segLen;
        }

        return false;
    }

    private static bool TryWebp(byte[] d, out double w, out double h)
    {
        w = 0; h = 0;
        // "RIFF"...."WEBP" then a chunk: VP8 (lossy), VP8L (lossless), or VP8X (extended).
        if (d.Length < 30) return false;
        if (d[0] != 'R' || d[1] != 'I' || d[2] != 'F' || d[3] != 'F') return false;
        if (d[8] != 'W' || d[9] != 'E' || d[10] != 'B' || d[11] != 'P') return false;

        var fourCc = Encoding.ASCII.GetString(d, 12, 4);
        switch (fourCc)
        {
            case "VP8 ":
                // Lossy: 16-bit width/height (14 bits used) at offset 26, little-endian.
                w = ((d[27] << 8 | d[26]) & 0x3FFF);
                h = ((d[29] << 8 | d[28]) & 0x3FFF);
                return w > 0 && h > 0;
            case "VP8L":
                // Lossless: 14-bit dimensions packed after the 0x2F signature at offset 21.
                var b0 = d[21]; var b1 = d[22]; var b2 = d[23]; var b3 = d[24];
                w = ((b1 & 0x3F) << 8 | b0) + 1;
                h = ((b3 & 0x0F) << 10 | b2 << 2 | (b1 & 0xC0) >> 6) + 1;
                return w > 0 && h > 0;
            case "VP8X":
                // Extended: 24-bit width-1 / height-1 at offset 24, little-endian.
                w = (d[24] | d[25] << 8 | d[26] << 16) + 1;
                h = (d[27] | d[28] << 8 | d[29] << 16) + 1;
                return w > 0 && h > 0;
            default:
                return false;
        }
    }

    private static bool TrySvg(byte[] d, out double w, out double h)
    {
        w = 0; h = 0;
        // Scan only the opening <svg ...> tag. width/height attributes win; otherwise fall
        // back to the viewBox's width/height (the last two numbers).
        var text = Encoding.UTF8.GetString(d, 0, Math.Min(d.Length, 4096));
        var start = text.IndexOf("<svg", StringComparison.OrdinalIgnoreCase);
        if (start < 0) return false;
        var end = text.IndexOf('>', start);
        var tag = end > start ? text.Substring(start, end - start) : text.Substring(start);

        var aw = ParseLengthAttr(tag, "width");
        var ah = ParseLengthAttr(tag, "height");
        if (aw > 0 && ah > 0) { w = aw; h = ah; return true; }

        if (TryParseViewBox(tag, out var vbw, out var vbh) && vbw > 0 && vbh > 0)
        {
            w = vbw; h = vbh;
            return true;
        }

        return false;
    }

    private static double ParseLengthAttr(string tag, string attr)
    {
        var idx = tag.IndexOf(attr + "=", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return 0;
        var q = tag.IndexOfAny(new[] { '"', '\'' }, idx);
        if (q < 0) return 0;
        var qEnd = tag.IndexOf(tag[q], q + 1);
        if (qEnd < 0) return 0;

        var raw = tag.Substring(q + 1, qEnd - q - 1).Trim();
        // Strip a trailing unit (px, pt, mm, ...); percentages are not usable as intrinsic size.
        if (raw.EndsWith("%")) return 0;
        var numEnd = 0;
        while (numEnd < raw.Length && (char.IsDigit(raw[numEnd]) || raw[numEnd] == '.' || raw[numEnd] == '-' || raw[numEnd] == '+'))
            numEnd++;
        var num = raw.Substring(0, numEnd);
        return double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : 0;
    }

    private static bool TryParseViewBox(string tag, out double w, out double h)
    {
        w = 0; h = 0;
        var idx = tag.IndexOf("viewBox=", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return false;
        var q = tag.IndexOfAny(new[] { '"', '\'' }, idx);
        if (q < 0) return false;
        var qEnd = tag.IndexOf(tag[q], q + 1);
        if (qEnd < 0) return false;

        var parts = tag.Substring(q + 1, qEnd - q - 1)
            .Split(new[] { ' ', ',', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 4) return false;

        return double.TryParse(parts[2], NumberStyles.Float, CultureInfo.InvariantCulture, out w)
               && double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out h);
    }

    private static uint ReadUInt32Be(byte[] d, int offset) =>
        (uint)((d[offset] << 24) | (d[offset + 1] << 16) | (d[offset + 2] << 8) | d[offset + 3]);
}
