using System;
using System.Globalization;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Import.Svg;

// Parses the SVG/CSS color forms we can represent: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(),
// 'none', 'transparent', and a small set of common named colors. Unknown names fall back to
// Color.Named so they survive into the renderer untouched. 'none' is signalled via the
// HasColor=false result so callers can distinguish "no fill" from "black fill".
internal static class SvgColorParser
{
    public static bool TryParse(string value, out Color color)
    {
        color = Color.Black;
        if (string.IsNullOrWhiteSpace(value)) return false;

        var v = value.Trim();

        if (v.Equals("none", StringComparison.OrdinalIgnoreCase)) return false;
        if (v.Equals("transparent", StringComparison.OrdinalIgnoreCase))
        {
            color = Color.Transparent;
            return true;
        }

        if (v.StartsWith("#"))
        {
            return TryParseHex(v, out color);
        }

        if (v.StartsWith("rgb", StringComparison.OrdinalIgnoreCase))
        {
            return TryParseRgbFunc(v, out color);
        }

        return TryParseNamed(v, out color);
    }

    private static bool TryParseHex(string v, out Color color)
    {
        color = Color.Black;
        var h = v.TrimStart('#');
        try
        {
            // #rgb / #rgba shorthand → expand each nibble.
            if (h.Length == 3 || h.Length == 4)
            {
                var r = (byte)(HexNibble(h[0]) * 17);
                var g = (byte)(HexNibble(h[1]) * 17);
                var b = (byte)(HexNibble(h[2]) * 17);
                var a = h.Length == 4 ? (byte)(HexNibble(h[3]) * 17) : (byte)255;
                color = Color.Rgb(r, g, b, a);
                return true;
            }

            if (h.Length == 6 || h.Length == 8)
            {
                color = Color.FromHex(h);
                return true;
            }
        }
        catch
        {
            // fall through
        }

        return false;
    }

    private static bool TryParseRgbFunc(string v, out Color color)
    {
        color = Color.Black;
        var open = v.IndexOf('(');
        var close = v.IndexOf(')');
        if (open < 0 || close < 0 || close < open) return false;

        var inner = v.Substring(open + 1, close - open - 1);
        var parts = inner.Split(new[] { ',', ' ', '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 3) return false;

        if (!TryParseChannel(parts[0], out var r) ||
            !TryParseChannel(parts[1], out var g) ||
            !TryParseChannel(parts[2], out var b))
        {
            return false;
        }

        var a = 1f;
        if (parts.Length >= 4)
        {
            if (!float.TryParse(parts[3].TrimEnd('%'), NumberStyles.Float, CultureInfo.InvariantCulture, out a))
                a = 1f;
            if (parts[3].EndsWith("%")) a /= 100f;
        }

        color = Color.Rgb(r, g, b, a);
        return true;
    }

    private static bool TryParseChannel(string s, out float value)
    {
        value = 0;
        s = s.Trim();
        if (s.EndsWith("%"))
        {
            if (!float.TryParse(s.TrimEnd('%'), NumberStyles.Float, CultureInfo.InvariantCulture, out var pct))
                return false;
            value = pct / 100f;
            return true;
        }

        if (!float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var raw)) return false;
        value = raw / 255f;
        return true;
    }

    private static bool TryParseNamed(string v, out Color color)
    {
        switch (v.ToLowerInvariant())
        {
            case "black": color = Color.Rgb((byte)0, 0, 0); return true;
            case "white": color = Color.White; return true;
            case "red": color = Color.Rgb((byte)255, 0, 0); return true;
            case "green": color = Color.Rgb((byte)0, 128, 0); return true;
            case "lime": color = Color.Rgb((byte)0, 255, 0); return true;
            case "blue": color = Color.Rgb((byte)0, 0, 255); return true;
            case "yellow": color = Color.Rgb((byte)255, 255, 0); return true;
            case "cyan":
            case "aqua": color = Color.Rgb((byte)0, 255, 255); return true;
            case "magenta":
            case "fuchsia": color = Color.Rgb((byte)255, 0, 255); return true;
            case "gray":
            case "grey": color = Color.Rgb((byte)128, 128, 128); return true;
            case "silver": color = Color.Rgb((byte)192, 192, 192); return true;
            case "orange": color = Color.Rgb((byte)255, 165, 0); return true;
            default:
                // Preserve unknown names (e.g. 'currentColor') for the renderer to resolve.
                color = Color.Named(v);
                return true;
        }
    }

    private static int HexNibble(char c)
    {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        throw new FormatException($"Invalid hex digit '{c}'");
    }
}
