using System;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

public enum DimensionTickKind { Arrow, Tick, None }
public enum DimensionTextPlacement { AboveLine, BreakLine }
public enum DimensionKind { Linear, Angular }

// Style for dimension rendering. Mirrors today's DimensionStyle but renderer-agnostic
// (no SVG-specific knobs). Extension/text/arrow factors are multiples of TextSize so the
// dim scales sanely across paper sizes.
public sealed class DimensionStyle
{
	public double TextSize { get; init; } = 2.5;
	public double StrokeWidth { get; init; } = 0.25;
	public Color Color { get; init; } = Color.Black;
	public string FontFamily { get; init; } = "Inter";

	public double ExtensionGapFactor { get; init; } = 0.4;
	public double ExtensionOvershootFactor { get; init; } = 0.3;
	// Caps witness-line length at TextSize × this factor when |Offset| is larger, so a
	// dim line placed far from the measured points doesn't drag huge extension lines
	// from each point. Matches AutoCAD/Revit behavior. <= 0 disables the cap.
	public double ExtensionLengthFactor { get; init; } = 8.0;
	public double TextLiftFactor { get; init; } = 0.6;
	public double TextSidePaddingFactor { get; init; } = 0.5;

	public DimensionTickKind TickKind { get; init; } = DimensionTickKind.Arrow;
	public DimensionTextPlacement TextPlacement { get; init; } = DimensionTextPlacement.AboveLine;
	public bool AutoFlipArrows { get; init; } = true;
	// Absolute arrow/tick size in paper-space mm. When > 0, takes precedence over the
	// legacy ArrowSizeFactor (which scales arrows with TextSize). Set this for sizes that
	// should be independent of text height; leave at 0 for the historical multiplier.
	public double ArrowSize { get; init; } = 0.0;
	public double ArrowSizeFactor { get; init; } = 1.6;

	// Resolved paper-space arrow size: absolute when ArrowSize > 0, else TextSize × factor.
	public double ResolvedArrowSize() => ArrowSize > 0 ? ArrowSize : TextSize * ArrowSizeFactor;
}

// Semantic dimension element: keeps the geometric intent (vertex/arms/offset/label) so
// renderers can re-emit the lines+arrows+arc on demand, and so layout decisions (text
// placement, auto-flip) stay correct after transforms. Concretely, today's
// LinearDimensionBuilder + AngularDimensionBuilder will populate this in Phase 3 instead
// of pre-rendering an SVG fragment.
public sealed class DimensionElement : DrawElement
{
	public DimensionKind Kind { get; init; }

	// Linear: A and B are the two measured endpoints; Offset is signed perpendicular distance
	// (positive = left of A→B). Vertex is unused.
	// Angular: Vertex is the angle apex; A and B are points along the two arms (their
	// distance from Vertex defines the arm directions, not the arc radius). Offset is the
	// arc radius.
	public Point2D A { get; init; }
	public Point2D B { get; init; }
	public Point2D Vertex { get; init; }
	public double Offset { get; init; }

	// Label override; if null, renderer/builder substitutes the measured value.
	public string Label { get; init; }

	public DimensionStyle Style { get; init; } = new DimensionStyle();

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		// Conservative: include endpoints, vertex, and inflate by enough to capture the
		// extension lines + arrows + label. Renderers can produce a tighter bound at emit
		// time once they've placed the text; this is good enough for viewBox + layout.
		var b = BoundingBox.FromPoint(A).Union(B);
		if (Kind == DimensionKind.Angular) b = b.Union(Vertex);

		var ts = Style?.TextSize ?? 2.5;
		var pad = Math.Max(Math.Abs(Offset), 0) + ts * 4;
		return b.Inflate(pad, pad);
	}
}
