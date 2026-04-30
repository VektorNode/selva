using System.Drawing;
using System.Globalization;
using System.Text;

namespace Selva.Drawing;

public static class SvgWriter
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static void AppendStyle(StringBuilder sb, PathStyleData style, bool defaultFillNone = true)
    {
        if (style == null)
        {
            if (defaultFillNone) sb.Append(" fill='none' stroke='black'");
            return;
        }

        if (style.HasFill)
        {
            sb.Append(" fill='").Append(Rgb(style.FillColor)).Append('\'');
            if (style.FillOpacity < 1f) sb.Append(" fill-opacity='").Append(F(style.FillOpacity)).Append('\'');
        }
        else
        {
            sb.Append(" fill='none'");
        }

        if (style.HasStroke && style.StrokeWidth > 0)
        {
            sb.Append(" stroke='").Append(Rgb(style.StrokeColor)).Append('\'');
            sb.Append(" stroke-width='").Append(F(style.StrokeWidth)).Append('\'');
            if (style.StrokeOpacity < 1f) sb.Append(" stroke-opacity='").Append(F(style.StrokeOpacity)).Append('\'');
            if (style.StrokeCap != SvgStrokeCap.Butt)
                sb.Append(" stroke-linecap='").Append(style.StrokeCap.ToString().ToLowerInvariant()).Append('\'');
            if (style.StrokeJoin != SvgStrokeJoin.Miter)
                sb.Append(" stroke-linejoin='").Append(style.StrokeJoin.ToString().ToLowerInvariant()).Append('\'');
            if (style.DashArray != null && style.DashArray.Length > 0)
            {
                sb.Append(" stroke-dasharray='");
                for (var i = 0; i < style.DashArray.Length; i++)
                {
                    if (i > 0) sb.Append(' ');
                    sb.Append(F(style.DashArray[i]));
                }
                sb.Append('\'');
            }
            if (style.NonScalingStroke) sb.Append(" vector-effect='non-scaling-stroke'");
        }
        else
        {
            sb.Append(" stroke='none'");
        }
    }

    public static string Rgb(Color c) => ColorValue(c);

    public static string ColorValue(Color c) =>
        c.A < 255
            ? $"rgba({c.R},{c.G},{c.B},{c.A / 255f:0.####})"
            : $"rgb({c.R},{c.G},{c.B})";

    public static string F(double v) => v.ToString("0.######", Inv);

    public static string Escape(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        return s.Replace("&", "&amp;").Replace("'", "&apos;").Replace("<", "&lt;").Replace(">", "&gt;");
    }
}
