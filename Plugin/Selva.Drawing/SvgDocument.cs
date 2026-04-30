using System.Collections.Generic;
using System.Text;

namespace Selva.Drawing;

public static class SvgDocument
{
    public const string DefaultFontFamily =
        "Inter, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif";

    public static string Build(
        IList<SvgCurveData> curves,
        IList<SvgSurfaceData> surfaces,
        IList<SvgDimensionData> dimensions,
        IList<SvgTextData> texts = null,
        string title = "Drawing",
        double padding = 10.0,
        string backgroundColor = null,
        string fontFamily = null)
    {
        if (string.IsNullOrWhiteSpace(fontFamily)) fontFamily = DefaultFontFamily;
        if (texts == null) texts = new List<SvgTextData>();

        var bounds = SvgBounds.Empty;
        foreach (var s in surfaces) bounds.Union(s.Bounds);
        foreach (var c in curves) bounds.Union(c.Bounds);
        foreach (var d in dimensions) bounds.Union(d.Bounds);
        foreach (var t in texts) bounds.Union(t.Bounds);

        if (!bounds.IsValid)
            return "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'></svg>";

        // SVG viewBox uses post-Y-flip coordinates: world Y range becomes -maxY..-minY.
        var minX = bounds.MinX - padding;
        var minY = -bounds.MaxY - padding;
        var width = bounds.Width + padding * 2;
        var height = bounds.Height + padding * 2;

        var sb = new StringBuilder();
        sb.AppendLine("<?xml version='1.0' encoding='UTF-8'?>");
        sb.Append("<svg xmlns='http://www.w3.org/2000/svg' version='1.1'");
        sb.Append(" width='").Append(SvgWriter.F(width)).Append('\'');
        sb.Append(" height='").Append(SvgWriter.F(height)).Append('\'');
        sb.Append(" viewBox='")
          .Append(SvgWriter.F(minX)).Append(' ')
          .Append(SvgWriter.F(minY)).Append(' ')
          .Append(SvgWriter.F(width)).Append(' ')
          .Append(SvgWriter.F(height)).Append('\'');
        sb.AppendLine(">");

        if (!string.IsNullOrEmpty(title))
            sb.Append("<title>").Append(SvgWriter.Escape(title)).AppendLine("</title>");

        // Dimension markers: arrow (mechanical), tick (architectural 45° slash), dot.
        if (dimensions.Count > 0)
        {
            sb.AppendLine("<defs>");
            sb.AppendLine("  <marker id='selva-dim-arrow' viewBox='0 0 10 10' refX='10' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>");
            sb.AppendLine("    <path d='M 0 0 L 10 5 L 0 10 Z' fill='context-stroke' />");
            sb.AppendLine("  </marker>");
            sb.AppendLine("  <marker id='selva-dim-tick' viewBox='-5 -5 10 10' refX='0' refY='0' markerWidth='10' markerHeight='10' orient='auto'>");
            sb.AppendLine("    <path d='M -3 3 L 3 -3' stroke='context-stroke' stroke-width='1' />");
            sb.AppendLine("  </marker>");
            sb.AppendLine("</defs>");
        }

        // Optional background rect (outside the Y-flip group — SVG coordinates)
        if (!string.IsNullOrEmpty(backgroundColor))
            sb.Append("<rect width='100%' height='100%' fill='").Append(SvgWriter.Escape(backgroundColor)).AppendLine("' />");

        // Single root Y-flip — everything else uses Rhino-world coordinates.
        // font-family is set here so all <text> descendants inherit it. The stack may
        // contain "Quoted Names" — encode them as &quot; so the single-quoted attr stays valid.
        sb.Append("<g transform='matrix(1 0 0 -1 0 0)' font-family='")
          .Append(SvgWriter.Escape(fontFamily).Replace("\"", "&quot;"))
          .AppendLine("'>");

        foreach (var s in surfaces) AppendSurface(sb, s);
        foreach (var c in curves) AppendCurve(sb, c);
        foreach (var d in dimensions) AppendDimension(sb, d);
        foreach (var t in texts) AppendText(sb, t);

        sb.AppendLine("</g>");
        sb.AppendLine("</svg>");
        return sb.ToString();
    }

    private static void AppendCurve(StringBuilder sb, SvgCurveData c)
    {
        sb.Append("  <path");
        AppendIdClass(sb, c.Id, c.CssClass);
        sb.Append(" d='").Append(c.PathData).Append('\'');
        SvgWriter.AppendStyle(sb, c.Style);
        AppendData(sb, c.Metadata);
        sb.AppendLine(" />");
    }

    private static void AppendSurface(StringBuilder sb, SvgSurfaceData s)
    {
        sb.Append("  <path");
        AppendIdClass(sb, s.Id, s.CssClass);
        sb.Append(" d='").Append(s.CombinedPathData).Append('\'');
        var fillRule = s.Style?.FillRule ?? SvgFillRule.EvenOdd;
        if (s.HolePathData.Count > 0 || fillRule == SvgFillRule.NonZero)
            sb.Append(" fill-rule='").Append(fillRule == SvgFillRule.NonZero ? "nonzero" : "evenodd").Append('\'');
        SvgWriter.AppendStyle(sb, s.Style, defaultFillNone: false);
        AppendData(sb, s.Metadata);
        sb.AppendLine(" />");
    }

    private static void AppendDimension(StringBuilder sb, SvgDimensionData d)
    {
        sb.Append("  <g class='dimension");
        if (!string.IsNullOrEmpty(d.CssClass)) sb.Append(' ').Append(d.CssClass);
        sb.Append('\'');
        if (!string.IsNullOrEmpty(d.Id)) sb.Append(" id='").Append(SvgWriter.Escape(d.Id)).Append('\'');
        sb.AppendLine(">");
        sb.Append(d.Body);
        sb.AppendLine("  </g>");
    }

    private static void AppendIdClass(StringBuilder sb, string id, string cls)
    {
        if (!string.IsNullOrEmpty(id)) sb.Append(" id='").Append(SvgWriter.Escape(id)).Append('\'');
        if (!string.IsNullOrEmpty(cls)) sb.Append(" class='").Append(SvgWriter.Escape(cls)).Append('\'');
    }

    private static void AppendText(StringBuilder sb, SvgTextData t)
    {
        // Text is positioned in Rhino-world space; the root Y-flip would invert it,
        // so we counter-flip with scale(1,-1) and then apply the user rotation.
        sb.Append("  <text x='0' y='0'");
        AppendIdClass(sb, t.Id, t.CssClass);
        sb.Append(" font-size='").Append(SvgWriter.F(t.FontSize)).Append('\'');
        sb.Append(" fill='").Append(SvgWriter.ColorValue(t.Color)).Append('\'');
        sb.Append(" text-anchor='").Append(AnchorToSvg(t.Anchor)).Append('\'');
        sb.Append(" dominant-baseline='middle'");
        sb.Append(" transform='translate(").Append(SvgWriter.F(t.X)).Append(' ').Append(SvgWriter.F(t.Y))
          .Append(") scale(1 -1) rotate(").Append(SvgWriter.F(-t.RotationDegrees)).Append(")'");
        AppendData(sb, t.Metadata);
        sb.Append('>').Append(SvgWriter.Escape(t.Text)).AppendLine("</text>");
    }

    private static string AnchorToSvg(SvgTextAnchor anchor) => anchor switch
    {
        SvgTextAnchor.Center => "middle",
        SvgTextAnchor.Right => "end",
        _ => "start"
    };

    private static void AppendData(StringBuilder sb, IDictionary<string, string> metadata)
    {
        if (metadata == null) return;
        foreach (var kv in metadata)
        {
            if (string.IsNullOrEmpty(kv.Key) || kv.Key.StartsWith("_")) continue;
            sb.Append(" data-").Append(kv.Key).Append("='").Append(SvgWriter.Escape(kv.Value)).Append('\'');
        }
    }
}
