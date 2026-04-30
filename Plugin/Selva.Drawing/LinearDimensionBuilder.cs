using System;
using System.Drawing;
using System.Globalization;
using System.Text;

namespace Selva.Drawing;

public enum DimensionTickStyle { Arrow, Tick, None }
public enum DimensionTextPlacement { AboveLine, BreakLine }

public class DimensionStyle
{
    public double TextSize { get; set; } = 2.5;
    public double StrokeWidth { get; set; } = 0.5;
    public Color Color { get; set; } = Color.Black;

    // CAD-style spacing, expressed as multiples of TextSize so the dim scales sanely.
    public double ExtensionGapFactor { get; set; } = 0.4;       // gap between geometry and start of extension line
    public double ExtensionOvershootFactor { get; set; } = 0.3; // how far extension line extends past the dim line
    public double TextLiftFactor { get; set; } = 0.6;           // distance from dim line to text center (must clear half-height + gap)
    public double TextSidePaddingFactor { get; set; } = 0.5;    // padding around text when breaking the dim line

    public DimensionTickStyle TickStyle { get; set; } = DimensionTickStyle.Arrow;
    public DimensionTextPlacement TextPlacement { get; set; } = DimensionTextPlacement.AboveLine;

    // When the dim is too short for inside arrows, flip them outside automatically.
    public bool AutoFlipArrows { get; set; } = true;
    public double ArrowSizeFactor { get; set; } = 1.6; // arrow visual size as multiple of text size
}

// Pure builder: takes primitives, returns SvgDimensionData. Has no Rhino dependency.
public static class LinearDimensionBuilder
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static SvgDimensionData Build(
        double ax, double ay,
        double bx, double by,
        double offset,
        string label,
        DimensionStyle style,
        string cssClass = null)
    {
        if (style == null) throw new ArgumentNullException(nameof(style));

        var dx = bx - ax;
        var dy = by - ay;
        var len = Math.Sqrt(dx * dx + dy * dy);
        if (len < 1e-9) return null;

        // Unit direction A→B and left-perpendicular (+90°).
        var ux = dx / len;
        var uy = dy / len;
        var nx = -uy;
        var ny = ux;

        var ts = style.TextSize;
        var extGap = ts * style.ExtensionGapFactor;
        var extOver = ts * style.ExtensionOvershootFactor;
        var arrowSize = ts * style.ArrowSizeFactor;

        // Extension lines: start offset from geometry, end past the dim line.
        var sign = offset >= 0 ? 1 : -1;
        var extStartA = (ax + nx * extGap * sign, ay + ny * extGap * sign);
        var extStartB = (bx + nx * extGap * sign, by + ny * extGap * sign);
        var extEndA = (ax + nx * (offset + extOver * sign), ay + ny * (offset + extOver * sign));
        var extEndB = (bx + nx * (offset + extOver * sign), by + ny * (offset + extOver * sign));

        // Dim line endpoints (exactly at dim offset).
        var dimA = (ax + nx * offset, ay + ny * offset);
        var dimB = (bx + nx * offset, by + ny * offset);

        // Auto-flip arrows when the dim line is too short to fit them inside.
        var flipArrows = style.AutoFlipArrows
            && style.TickStyle == DimensionTickStyle.Arrow
            && len < arrowSize * 3.0;

        // Text content + placement.
        var text = string.IsNullOrEmpty(label)
            ? len.ToString("0.##", Inv)
            : label;
        // Above-line placement lifts the text clear of the line; break-line sits the text
        // directly on the dim line (the line itself is broken to make room).
        var textLift = style.TextPlacement == DimensionTextPlacement.BreakLine
            ? 0.0
            : ts * style.TextLiftFactor;
        var midX = (dimA.Item1 + dimB.Item1) * 0.5 + nx * textLift * sign;
        var midY = (dimA.Item2 + dimB.Item2) * 0.5 + ny * textLift * sign;

        // Keep text upright: flip 180° when angle would render it upside down.
        var angleDeg = Math.Atan2(uy, ux) * 180.0 / Math.PI;
        if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

        var sb = new StringBuilder();
        var strokeAttr = $"stroke='{SvgWriter.Rgb(style.Color)}' stroke-width='{F(style.StrokeWidth)}' fill='none' vector-effect='non-scaling-stroke'";

        // Extension lines (with gap from geometry, overshoot past dim line).
        AppendLine(sb, strokeAttr, extStartA.Item1, extStartA.Item2, extEndA.Item1, extEndA.Item2);
        AppendLine(sb, strokeAttr, extStartB.Item1, extStartB.Item2, extEndB.Item1, extEndB.Item2);

        // Dim line (or two halves with text gap).
        if (style.TextPlacement == DimensionTextPlacement.BreakLine)
        {
            // Estimate a text-width gap; SVG-ish heuristic: ~0.55 × textSize per character.
            var textHalfWidth = text.Length * ts * 0.55 * 0.5 + ts * style.TextSidePaddingFactor;
            var midWorldX = (dimA.Item1 + dimB.Item1) * 0.5;
            var midWorldY = (dimA.Item2 + dimB.Item2) * 0.5;
            var gapAx = midWorldX - ux * textHalfWidth;
            var gapAy = midWorldY - uy * textHalfWidth;
            var gapBx = midWorldX + ux * textHalfWidth;
            var gapBy = midWorldY + uy * textHalfWidth;

            AppendDimSegment(sb, strokeAttr, dimA.Item1, dimA.Item2, gapAx, gapAy, style.TickStyle, flipArrows, startTick: true, endTick: false);
            AppendDimSegment(sb, strokeAttr, gapBx, gapBy, dimB.Item1, dimB.Item2, style.TickStyle, flipArrows, startTick: false, endTick: true);
        }
        else
        {
            AppendDimSegment(sb, strokeAttr, dimA.Item1, dimA.Item2, dimB.Item1, dimB.Item2, style.TickStyle, flipArrows, startTick: true, endTick: true);
        }

        // Outside-flipped arrow stubs: draw short stubs outside the dim line endpoints
        // so the arrows have something to point at. Markers are placed via marker-end,
        // pointing inward toward the dim endpoint.
        if (flipArrows && style.TickStyle == DimensionTickStyle.Arrow)
        {
            var stub = arrowSize * 1.5;
            var outAx = dimA.Item1 - ux * stub;
            var outAy = dimA.Item2 - uy * stub;
            var outBx = dimB.Item1 + ux * stub;
            var outBy = dimB.Item2 + uy * stub;
            sb.Append("    <line ").Append(strokeAttr)
              .Append(" marker-end='url(#selva-dim-arrow)'")
              .Append(" x1='").Append(F(outAx)).Append("' y1='").Append(F(outAy))
              .Append("' x2='").Append(F(dimA.Item1)).Append("' y2='").Append(F(dimA.Item2))
              .AppendLine("' />");
            sb.Append("    <line ").Append(strokeAttr)
              .Append(" marker-end='url(#selva-dim-arrow)'")
              .Append(" x1='").Append(F(outBx)).Append("' y1='").Append(F(outBy))
              .Append("' x2='").Append(F(dimB.Item1)).Append("' y2='").Append(F(dimB.Item2))
              .AppendLine("' />");
        }

        // Label. Translate to midpoint, counter-flip Y (cancels root Y-flip), then rotate to dim-line angle.
        sb.Append("    <text x='0' y='0'")
          .Append(" font-size='").Append(F(ts)).Append('\'')
          .Append(" fill='").Append(SvgWriter.Rgb(style.Color)).Append('\'')
          .Append(" text-anchor='middle' dominant-baseline='middle'")
          .Append(" transform='translate(").Append(F(midX)).Append(' ').Append(F(midY))
          .Append(") scale(1 -1) rotate(").Append(F(-angleDeg)).Append(")'")
          .Append('>').Append(SvgWriter.Escape(text)).AppendLine("</text>");

        var bounds = SvgBounds.Empty;
        bounds.Union(ax, ay);
        bounds.Union(bx, by);
        bounds.Union(extEndA.Item1, extEndA.Item2);
        bounds.Union(extEndB.Item1, extEndB.Item2);
        bounds.Union(dimA.Item1, dimA.Item2);
        bounds.Union(dimB.Item1, dimB.Item2);

        return new SvgDimensionData
        {
            Body = sb.ToString(),
            Bounds = bounds,
            CssClass = cssClass
        };
    }

    private static void AppendLine(StringBuilder sb, string strokeAttr, double x1, double y1, double x2, double y2)
    {
        sb.Append("    <line ").Append(strokeAttr)
          .Append(" x1='").Append(F(x1)).Append("' y1='").Append(F(y1))
          .Append("' x2='").Append(F(x2)).Append("' y2='").Append(F(y2))
          .AppendLine("' />");
    }

    private static void AppendDimSegment(
        StringBuilder sb, string strokeAttr,
        double x1, double y1, double x2, double y2,
        DimensionTickStyle tickStyle, bool flipArrows,
        bool startTick, bool endTick)
    {
        sb.Append("    <line ").Append(strokeAttr);

        if (tickStyle == DimensionTickStyle.Arrow && !flipArrows)
        {
            if (startTick) sb.Append(" marker-start='url(#selva-dim-arrow)'");
            if (endTick) sb.Append(" marker-end='url(#selva-dim-arrow)'");
        }
        else if (tickStyle == DimensionTickStyle.Tick)
        {
            if (startTick) sb.Append(" marker-start='url(#selva-dim-tick)'");
            if (endTick) sb.Append(" marker-end='url(#selva-dim-tick)'");
        }

        sb.Append(" x1='").Append(F(x1)).Append("' y1='").Append(F(y1))
          .Append("' x2='").Append(F(x2)).Append("' y2='").Append(F(y2))
          .AppendLine("' />");
    }

    private static string F(double v) => v.ToString("0.######", Inv);
}
