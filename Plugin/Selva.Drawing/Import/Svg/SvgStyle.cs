using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Import.Svg;

// Resolved presentation state inherited down the SVG tree. Tracks only the properties the
// model can represent (fill, stroke, widths, opacities, fill-rule). Reads both presentation
// attributes (fill="...") and the inline style="..." attribute; style wins, per CSS.
internal sealed class SvgStyle
{
    // null = not specified at this level, inherit. Fill's default (black) is applied in
    // ToFill(), not here, so an explicit fill="none" can still win over it.
    public string Fill { get; private set; }
    public string Stroke { get; private set; }
    public double? StrokeWidth { get; private set; }
    public double? Opacity { get; private set; }
    public double? FillOpacity { get; private set; }
    public double? StrokeOpacity { get; private set; }
    public FillRule? FillRule { get; private set; }

    public SvgStyle InheritFrom(XElement el)
    {
        var inline = ParseStyleAttribute(el.Attribute("style")?.Value);

        string Get(string prop) =>
            inline.TryGetValue(prop, out var v) ? v : el.Attribute(prop)?.Value;

        var child = new SvgStyle
        {
            Fill = Get("fill") ?? Fill,
            Stroke = Get("stroke") ?? Stroke,
            StrokeWidth = ParseNullableNum(Get("stroke-width")) ?? StrokeWidth,
            Opacity = ParseNullableNum(Get("opacity")) ?? Opacity,
            FillOpacity = ParseNullableNum(Get("fill-opacity")) ?? FillOpacity,
            StrokeOpacity = ParseNullableNum(Get("stroke-opacity")) ?? StrokeOpacity,
            FillRule = ParseFillRule(Get("fill-rule")) ?? FillRule,
        };

        return child;
    }

    public Fill ToFill()
    {
        var raw = Fill;
        if (raw != null && raw.Trim().Equals("none", StringComparison.OrdinalIgnoreCase)) return null;

        Color color;
        if (raw == null)
        {
            color = Color.Black;
        }
        else if (!SvgColorParser.TryParse(raw, out color))
        {
            return null; // unparseable / none
        }

        var opacity = (FillOpacity ?? 1.0) * (Opacity ?? 1.0);
        return new Fill
        {
            Color = color,
            Opacity = Clamp01(opacity),
            Rule = FillRule ?? Model.Style.FillRule.NonZero,
        };
    }

    public Stroke ToStroke()
    {
        if (Stroke == null) return null;
        if (Stroke.Trim().Equals("none", StringComparison.OrdinalIgnoreCase)) return null;
        if (!SvgColorParser.TryParse(Stroke, out var color)) return null;

        var opacity = (StrokeOpacity ?? 1.0) * (Opacity ?? 1.0);
        return new Stroke
        {
            Color = color,
            Width = StrokeWidth ?? 1.0,
            Opacity = Clamp01(opacity),
        };
    }

    private static Dictionary<string, string> ParseStyleAttribute(string style)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(style)) return map;

        foreach (var decl in style.Split(';'))
        {
            var idx = decl.IndexOf(':');
            if (idx <= 0) continue;
            var key = decl.Substring(0, idx).Trim();
            var val = decl.Substring(idx + 1).Trim();
            if (key.Length > 0) map[key] = val;
        }
        return map;
    }

    private static double? ParseNullableNum(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        // Strips a trailing unit (px, etc.); percentages aren't supported here.
        var num = new string(s.TakeWhile(c => char.IsDigit(c) || c == '.' || c == '-' || c == '+').ToArray());
        return double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : (double?)null;
    }

    private static FillRule? ParseFillRule(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        return s.Trim().ToLowerInvariant() switch
        {
            "evenodd" => Model.Style.FillRule.EvenOdd,
            "nonzero" => Model.Style.FillRule.NonZero,
            _ => null,
        };
    }

    private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;
}
