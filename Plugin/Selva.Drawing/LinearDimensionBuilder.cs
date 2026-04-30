using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing;

// Pure builder. Phase 3 reduced this to a thin factory that packs inputs into a
// DimensionElement; the renderer (or PDF renderer) generates the actual lines/arrows/text
// from that semantic record. Returns null if the two endpoints coincide.
public static class LinearDimensionBuilder
{
    public static DimensionElement Build(
        double ax, double ay,
        double bx, double by,
        double offset,
        string label,
        DimensionStyle style)
    {
        if (style == null) throw new ArgumentNullException(nameof(style));

        var dx = bx - ax;
        var dy = by - ay;
        if (dx * dx + dy * dy < 1e-18) return null;

        return new DimensionElement
        {
            Kind = DimensionKind.Linear,
            A = new Point2D(ax, ay),
            B = new Point2D(bx, by),
            Offset = offset,
            Label = label,
            Style = style,
        };
    }
}
