using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing;

// Pure builder. Phase 3 reduced this to a thin factory that packs inputs into a
// DimensionElement; the renderer derives radius/arc/labels from the geometry. Returns
// null if the two arms are collinear or one of them is degenerate.
public static class AngularDimensionBuilder
{
    public static DimensionElement Build(
        double vx, double vy,
        double ax, double ay,
        double bx, double by,
        string label,
        DimensionStyle style,
        bool reflex = false)
    {
        if (style == null) throw new ArgumentNullException(nameof(style));

        // Reject degenerate arms or collinear-same-direction inputs early so callers can
        // report a warning. The renderer also tolerates these but produces no output.
        var dax = ax - vx; var day = ay - vy;
        var dbx = bx - vx; var dby = by - vy;
        if (dax * dax + day * day < 1e-18) return null;
        if (dbx * dbx + dby * dby < 1e-18) return null;

        var lenA = Math.Sqrt(dax * dax + day * day);
        var lenB = Math.Sqrt(dbx * dbx + dby * dby);
        var uax = dax / lenA; var uay = day / lenA;
        var ubx = dbx / lenB; var uby = dby / lenB;
        var dot = uax * ubx + uay * uby;
        var cross = uax * uby - uay * ubx;
        if (Math.Abs(Math.Atan2(cross, dot)) < 1e-6) return null;

        // Reflex flag is not yet on DimensionElement (Phase 3 left it out — typical use is
        // small-angle). When reflex is requested but unsupported, callers can flip A/B
        // themselves to get the same effect for now.
        _ = reflex;

        return new DimensionElement
        {
            Kind = DimensionKind.Angular,
            Vertex = new Point2D(vx, vy),
            A = new Point2D(ax, ay),
            B = new Point2D(bx, by),
            Label = label,
            Style = style,
        };
    }
}
