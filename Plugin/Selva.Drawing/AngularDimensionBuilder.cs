using System;
using System.Globalization;
using System.Text;

namespace Selva.Drawing;

// Pure builder: takes primitives, returns SvgDimensionData. Has no Rhino dependency.
//
// Renders an angular dimension at a vertex with an arc at the chosen radius from
// vertex toward A and B. Always picks the smaller (non-reflex) angle. Output is in
// Rhino-world coordinates and assumes the surrounding <g> applies the Y-flip.
public static class AngularDimensionBuilder
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static SvgDimensionData Build(
        double vx, double vy,
        double ax, double ay,
        double bx, double by,
        string label,
        DimensionStyle style,
        bool reflex = false,
        string cssClass = null)
    {
        if (style == null) throw new ArgumentNullException(nameof(style));

        // Direction vertex→A and vertex→B.
        var dax = ax - vx; var day = ay - vy;
        var dbx = bx - vx; var dby = by - vy;
        var lenA = Math.Sqrt(dax * dax + day * day);
        var lenB = Math.Sqrt(dbx * dbx + dby * dby);
        if (lenA < 1e-9 || lenB < 1e-9) return null;

        // Auto-radius: 30% of the shorter arm so the arc fits comfortably inside both.
        var radius = Math.Min(lenA, lenB) * 0.3;

        var uax = dax / lenA; var uay = day / lenA;
        var ubx = dbx / lenB; var uby = dby / lenB;

        // Signed angle from A to B in world coords (CCW positive).
        // dot = cos(theta), cross = sin(theta).
        var dot = uax * ubx + uay * uby;
        var cross = uax * uby - uay * ubx;
        var smallTheta = Math.Atan2(cross, dot); // (-pi, pi], the smaller angle
        var absSmall = Math.Abs(smallTheta);
        if (absSmall < 1e-6) return null; // collinear, same direction

        // theta = the angle we actually draw. For reflex, sweep the long way around
        // (sign flipped, magnitude = 2π - small).
        var theta = reflex
            ? -Math.Sign(smallTheta) * (2.0 * Math.PI - absSmall)
            : smallTheta;
        var absTheta = Math.Abs(theta);

        // sweepCcw = true means: arc travels CCW from A-direction to B-direction in world.
        var sweepCcw = theta > 0;

        var ts = style.TextSize;
        var arrowSize = ts * style.ArrowSizeFactor;

        // Arc endpoints on the radius circle around vertex.
        var arcStartX = vx + uax * radius;
        var arcStartY = vy + uay * radius;
        var arcEndX = vx + ubx * radius;
        var arcEndY = vy + uby * radius;

        // Bisector direction (toward the side of the angle the arc sits on, where text goes).
        // For the small angle, the bisector is uA+uB. For reflex, it's the opposite side.
        var bisX = uax + ubx;
        var bisY = uay + uby;
        var bisLen = Math.Sqrt(bisX * bisX + bisY * bisY);
        // For a 180° angle, A and B are opposite — bisector is degenerate. Pick the
        // perpendicular consistent with sweep direction.
        if (bisLen < 1e-9)
        {
            bisX = sweepCcw ? -uay : uay;
            bisY = sweepCcw ? uax : -uax;
            bisLen = 1.0;
        }
        bisX /= bisLen; bisY /= bisLen;
        if (reflex) { bisX = -bisX; bisY = -bisY; }

        var sb = new StringBuilder();
        var strokeAttr = $"stroke='{SvgWriter.Rgb(style.Color)}' stroke-width='{F(style.StrokeWidth)}' fill='none' vector-effect='non-scaling-stroke'";

        // Auto-flip arrows when arc length is too short to fit them inside.
        var arcLen = absTheta * radius;
        var flipArrows = style.AutoFlipArrows
            && style.TickStyle == DimensionTickStyle.Arrow
            && arcLen < arrowSize * 3.0;

        // SVG arc large-arc-flag: 1 if we're sweeping more than 180° (reflex case).
        // SVG arc sweep-flag: SVG's "sweep=1" means visually-clockwise in the rendered output.
        // World CCW (positive theta) becomes visually CW after the root Y-flip, so sweepCcw → flag=1.
        var largeArcFlag = absTheta > Math.PI ? 1 : 0;
        var sweepFlag = sweepCcw ? 1 : 0;

        // Arc path with optional arrow markers at both ends.
        sb.Append("    <path ").Append(strokeAttr);
        if (style.TickStyle == DimensionTickStyle.Arrow && !flipArrows)
        {
            sb.Append(" marker-start='url(#selva-dim-arrow)'");
            sb.Append(" marker-end='url(#selva-dim-arrow)'");
        }
        else if (style.TickStyle == DimensionTickStyle.Tick)
        {
            sb.Append(" marker-start='url(#selva-dim-tick)'");
            sb.Append(" marker-end='url(#selva-dim-tick)'");
        }
        sb.Append(" d='M ").Append(F(arcStartX)).Append(' ').Append(F(arcStartY))
          .Append(" A ").Append(F(radius)).Append(' ').Append(F(radius))
          .Append(" 0 ").Append(largeArcFlag).Append(' ').Append(sweepFlag).Append(' ')
          .Append(F(arcEndX)).Append(' ').Append(F(arcEndY))
          .AppendLine("' />");

        // Outside-flipped arrows: draw short tangent stubs at each endpoint pointing
        // outward, so the arrows have something to attach to.
        if (flipArrows && style.TickStyle == DimensionTickStyle.Arrow)
        {
            var stub = arrowSize * 1.5;

            // Tangent at arcStart, perpendicular to the radial direction (uA),
            // oriented along the sweep. Outward = opposite the inside-arc tangent.
            // Sweep direction at start: perpendicular to uA, rotated +90° if CCW, -90° if CW.
            double tStartX, tStartY;
            if (sweepCcw) { tStartX = -uay; tStartY = uax; }   // +90°
            else          { tStartX =  uay; tStartY = -uax; }  // -90°
            var outStartX = arcStartX - tStartX * stub;
            var outStartY = arcStartY - tStartY * stub;

            // Tangent at arcEnd: at B-end of the arc, sweep direction is the same
            // rotation applied to uB.
            double tEndX, tEndY;
            if (sweepCcw) { tEndX = -uby; tEndY = ubx; }
            else          { tEndX =  uby; tEndY = -ubx; }
            var outEndX = arcEndX + tEndX * stub;
            var outEndY = arcEndY + tEndY * stub;

            sb.Append("    <line ").Append(strokeAttr)
              .Append(" marker-end='url(#selva-dim-arrow)'")
              .Append(" x1='").Append(F(outStartX)).Append("' y1='").Append(F(outStartY))
              .Append("' x2='").Append(F(arcStartX)).Append("' y2='").Append(F(arcStartY))
              .AppendLine("' />");
            sb.Append("    <line ").Append(strokeAttr)
              .Append(" marker-end='url(#selva-dim-arrow)'")
              .Append(" x1='").Append(F(outEndX)).Append("' y1='").Append(F(outEndY))
              .Append("' x2='").Append(F(arcEndX)).Append("' y2='").Append(F(arcEndY))
              .AppendLine("' />");
        }

        // Label content — degrees with ° suffix unless overridden.
        var degrees = absTheta * 180.0 / Math.PI;
        var text = string.IsNullOrEmpty(label)
            ? degrees.ToString("0.##", Inv) + "°"
            : label;

        // Place text along the bisector at radius + lift so it sits outside the arc.
        var textLift = ts * style.TextLiftFactor;
        var textRadius = radius + textLift;
        var midX = vx + bisX * textRadius;
        var midY = vy + bisY * textRadius;

        // Rotate text to be tangent to the arc at the midpoint (perpendicular to bisector).
        // Keep upright.
        var bisAngleDeg = Math.Atan2(bisY, bisX) * 180.0 / Math.PI;
        var tangentAngleDeg = bisAngleDeg - 90.0;
        if (tangentAngleDeg > 90 || tangentAngleDeg < -90) tangentAngleDeg += 180;

        sb.Append("    <text x='0' y='0'")
          .Append(" font-size='").Append(F(ts)).Append('\'')
          .Append(" fill='").Append(SvgWriter.Rgb(style.Color)).Append('\'')
          .Append(" text-anchor='middle' dominant-baseline='middle'")
          .Append(" transform='translate(").Append(F(midX)).Append(' ').Append(F(midY))
          .Append(") scale(1 -1) rotate(").Append(F(-tangentAngleDeg)).Append(")'")
          .Append('>').Append(SvgWriter.Escape(text)).AppendLine("</text>");

        // Bounds: include vertex, arc endpoints, and label position. Cheap over-estimate.
        var bounds = SvgBounds.Empty;
        bounds.Union(vx, vy);
        bounds.Union(arcStartX, arcStartY);
        bounds.Union(arcEndX, arcEndY);
        bounds.Union(midX, midY);
        // Sample a few points along the arc for tighter bounds when the arc bulges.
        const int samples = 8;
        for (var i = 1; i < samples; i++)
        {
            var t = i / (double)samples;
            var ang = Math.Atan2(uay, uax) + theta * t;
            bounds.Union(vx + Math.Cos(ang) * radius, vy + Math.Sin(ang) * radius);
        }

        return new SvgDimensionData
        {
            Body = sb.ToString(),
            Bounds = bounds,
            CssClass = cssClass
        };
    }

    private static string F(double v) => v.ToString("0.######", Inv);
}
