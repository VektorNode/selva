using System;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

public enum DimensionTickKind { Arrow, Tick, None }
public enum DimensionTextPlacement { AboveLine, BreakLine }
public enum DimensionKind { Linear, Angular }

// Renderer-agnostic dimension style. Extension/text/arrow factors are multiples of
// TextSize so a dim scales sanely across paper sizes.
public sealed class DimensionStyle
{
	public double TextSize { get; init; } = 2.5;
	// Same convention as Stroke.Width: 0 suppresses the linework but the label still draws
	// (a dimension without lines is still a legible annotation).
	public double StrokeWidth { get; init; } = LineWeight.Fine;
	public Color Color { get; init; } = Color.Black;
	public string FontFamily { get; init; } = "Inter";

	public double ExtensionGapFactor { get; init; } = 0.4;
	public double ExtensionOvershootFactor { get; init; } = 0.3;
	// Caps witness-line length at TextSize x this factor when |Offset| is larger, so a
	// dim placed far from the measured points doesn't drag huge extension lines from each
	// point (matches AutoCAD/Revit). <= 0 disables the cap.
	public double ExtensionLengthFactor { get; init; } = 8.0;
	public double TextLiftFactor { get; init; } = 0.6;
	public double TextSidePaddingFactor { get; init; } = 0.5;

	public DimensionTickKind TickKind { get; init; } = DimensionTickKind.Arrow;
	public DimensionTextPlacement TextPlacement { get; init; } = DimensionTextPlacement.AboveLine;
	public bool AutoFlipArrows { get; init; } = true;
	// Absolute arrow/tick size in paper-space mm; when > 0, takes precedence over
	// ArrowSizeFactor. Leave at 0 to scale arrows with TextSize instead.
	public double ArrowSize { get; init; } = 0.0;
	public double ArrowSizeFactor { get; init; } = 1.6;

	public double ResolvedArrowSize() => ArrowSize > 0 ? ArrowSize : TextSize * ArrowSizeFactor;
}

// Keeps geometric intent (vertex/arms/offset/label) instead of a pre-rendered fragment, so
// renderers can re-emit lines+arrows+arc on demand and layout decisions (text placement,
// auto-flip) stay correct after transforms.
public sealed class DimensionElement : DrawElement
{
	public DimensionKind Kind { get; init; }

	// Linear: A/B are the measured endpoints; Offset is signed perpendicular distance
	// (positive = left of A->B); Vertex is unused.
	// Angular: Vertex is the angle apex; A/B are points along the two arms (their distance
	// from Vertex sets arm direction, not arc radius); Offset is the arc radius.
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
		// Conservative bound covering extension lines + arrows + label; renderers can
		// tighten it once they've placed the actual text.
		var b = BoundingBox.FromPoint(A).Union(B);
		if (Kind == DimensionKind.Angular) b = b.Union(Vertex);

		var ts = Style?.TextSize ?? 2.5;
		var pad = Math.Max(Math.Abs(Offset), 0) + ts * 4;
		return b.Inflate(pad, pad);
	}
}
