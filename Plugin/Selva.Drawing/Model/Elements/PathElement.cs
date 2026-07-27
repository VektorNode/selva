using System;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

// Generic stroked/filled path. Replaces today's SvgCurveData and SvgSurfaceData — a
// surface is just a PathElement with Fill set; multiple subpaths (holes) live in the same
// Path via repeated MoveTo+Close pairs.
public sealed class PathElement : DrawElement
{
	public Path Path { get; init; } = Path.Empty;
	public Stroke Stroke { get; init; }
	public Fill Fill { get; init; }

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		var b = Path.ComputeBounds();
		if (Stroke != null && Stroke.IsVisible)
		{
			var half = Stroke.Width / 2.0;
			b = b.Inflate(half, half);
		}
		return b;
	}
}
