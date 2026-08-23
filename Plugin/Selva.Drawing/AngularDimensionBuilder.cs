using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing;

// Packs inputs into a DimensionElement; the renderer derives radius/arc/labels from
// the geometry. Returns null if the two arms are collinear or one is degenerate.
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

        // DimensionElement has no reflex flag, so this parameter is ignored. Callers
        // needing the reflex angle should swap A and B instead.
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
