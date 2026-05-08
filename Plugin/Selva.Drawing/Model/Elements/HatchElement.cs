using System;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

public enum HatchPatternKind { Solid, Lines, CrossHatch, Dots }

// Region (Boundary path) filled with a pattern. SVG renderer expands to <pattern>; PDF
// renderer to a tiling pattern (or, for Solid, just a fill). Phase 1 only carries the
// declarative info — pattern generation is renderer-side.
public sealed class HatchElement : DrawElement
{
	public Path Boundary { get; init; } = Path.Empty;
	public HatchPatternKind Pattern { get; init; } = HatchPatternKind.Lines;
	public double Spacing { get; init; } = 2.0;
	public double AngleDegrees { get; init; } = 45.0;
	public Stroke LineStyle { get; init; } = new Stroke { Width = 0.18 };
	public Color BackgroundColor { get; init; } = Color.Transparent;
	public FillRule FillRule { get; init; } = FillRule.EvenOdd;

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds() => Boundary.ComputeBounds();
}
