using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Elements;

// Children + an optional transform. SVG <g> / PDF q...Q. Group bounds are the union of
// transformed child bounds — but a child's transform is local, so we compute the child
// bound first and then apply this group's transform to its corners.
//
// BoundsOverride lets a layout primitive (Grid, Frame, Table) pin the resolved group's
// outer extent to a known rectangle instead of the union-of-children. This matters when
// a track or cell is wider than its content — the layout primitive knows the full extent;
// the children alone don't carry it.
public sealed class GroupElement : DrawElement, IEnumerable<DrawElement>
{
	public IReadOnlyList<DrawElement> Children { get; init; } = Array.Empty<DrawElement>();
	public Transform Transform { get; init; } = Geometry.Transform.Identity;
	public BoundingBox? BoundsOverride { get; init; }

	// Marks a group as a viewport-only overlay (e.g. Grid cell dividers): the Rhino preview
	// draws its BoundsOverride as a dotted box, while SVG/PDF renderers skip it entirely.
	public bool PreviewOnly { get; init; }

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		if (BoundsOverride.HasValue)
			return Transform.IsIdentity
				? BoundsOverride.Value
				: TransformBox(BoundsOverride.Value, Transform);

		var bounds = BoundingBox.Empty;
		foreach (var child in Children)
		{
			var b = child.ComputeBounds();
			if (b.IsEmpty) continue;
			bounds = bounds.Union(TransformBox(b, Transform));
		}
		return bounds;
	}

	private static BoundingBox TransformBox(BoundingBox b, Transform t)
	{
		if (t.IsIdentity) return b;
		// Transform all four corners — for a rotated affine, axis-aligned bounds shift.
		var p1 = t.Apply(new Point2D(b.MinX, b.MinY));
		var p2 = t.Apply(new Point2D(b.MaxX, b.MinY));
		var p3 = t.Apply(new Point2D(b.MaxX, b.MaxY));
		var p4 = t.Apply(new Point2D(b.MinX, b.MaxY));
		return BoundingBox.FromPoint(p1).Union(p2).Union(p3).Union(p4);
	}

	// Collection-initializer support: `new GroupElement { childA, childB }` works.
	public IEnumerator<DrawElement> GetEnumerator() => Children.GetEnumerator();
	IEnumerator IEnumerable.GetEnumerator() => Children.GetEnumerator();
}
