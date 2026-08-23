using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Layout;

// A bordered/filled rectangle around a single child, with optional padding. The child's
// bounding box determines the inner rect; the outer rect grows by (Padding + Border.Width / 2)
// so the stroke sits centred on the edge.
//
// With Size set explicitly, the frame uses that size and centres the child inside the padded
// inner rect — for fixed-size title-block cells where the content may be smaller than the cell.
public sealed class Frame : LayoutElement
{
	public DrawElement Child { get; init; }
	public Stroke Border { get; init; }
	public Fill Background { get; init; }
	public Margins Padding { get; init; } = Margins.Zero;

	// Optional fixed size. When null, the frame sizes to fit the child + padding.
	public BoundingBox? Size { get; init; }

	// Origin of the frame's bottom-left corner in world coords. Defaults to (0,0).
	public Point2D Origin { get; init; } = Point2D.Zero;

	private LayoutContext BuildChildContext(LayoutContext parent)
	{
		double innerWidth, innerHeight;
		if (Size.HasValue)
		{
			innerWidth = Math.Max(0, Size.Value.Width - Padding.Left - Padding.Right);
			innerHeight = Math.Max(0, Size.Value.Height - Padding.Top - Padding.Bottom);
			if (innerWidth <= 0 || innerHeight <= 0) return new LayoutContext(BoundingBox.Empty);
		}
		else
		{
			// A parent may constrain only one axis (e.g. a vertical Stack gives width but
			// unbounded height); forward each axis independently. A degenerate (≤0) inner size
			// falls back to unconstrained so children use natural sizing.
			innerWidth = InnerSpan(parent.AvailableWidth, Padding.Left + Padding.Right);
			innerHeight = InnerSpan(parent.AvailableHeight, Padding.Top + Padding.Bottom);
			if (double.IsPositiveInfinity(innerWidth) && double.IsPositiveInfinity(innerHeight))
				return new LayoutContext(BoundingBox.Empty);
		}
		return new LayoutContext(new BoundingBox(0, 0, innerWidth, innerHeight));
	}

	private static double InnerSpan(double available, double padding)
	{
		if (double.IsInfinity(available)) return double.PositiveInfinity;
		var inner = available - padding;
		return inner > 0 ? inner : double.PositiveInfinity;
	}

	public override DrawElement Resolve(LayoutContext context)
	{
		var childContext = BuildChildContext(context);

		var resolvedChild = Child is LayoutElement nested
			? nested.Resolve(childContext)
			: Child;

		// Measure the resolved subtree, not the raw child: an unresolved auto-fit view or star
		// grid reports context-blind natural bounds that diverge from the constrained resolve
		// above, and the frame would size around a different box than the one it draws.
		var childBounds = resolvedChild?.ComputeBounds() ?? BoundingBox.Empty;

		double width, height;
		if (Size.HasValue)
		{
			width = Size.Value.Width;
			height = Size.Value.Height;
		}
		else if (childBounds.IsEmpty)
		{
			width = Padding.Left + Padding.Right;
			height = Padding.Top + Padding.Bottom;
		}
		else
		{
			width = childBounds.Width + Padding.Left + Padding.Right;
			height = childBounds.Height + Padding.Top + Padding.Bottom;
		}

		var minX = Origin.X;
		var minY = Origin.Y;
		var maxX = Origin.X + width;
		var maxY = Origin.Y + height;

		var children = new System.Collections.Generic.List<DrawElement>(2);

		// Background rect (drawn first so the border sits on top).
		if (Background != null || Border != null)
		{
			var rect = new Path.Builder()
				.MoveTo(minX, minY)
				.LineTo(maxX, minY)
				.LineTo(maxX, maxY)
				.LineTo(minX, maxY)
				.Close()
				.Build();
			children.Add(new PathElement
			{
				Path = rect,
				Stroke = Border,
				Fill = Background,
			});
		}

		if (resolvedChild != null && !childBounds.IsEmpty)
		{
			var innerLeft = minX + Padding.Left;
			var innerBottom = minY + Padding.Bottom;
			var innerWidth = Math.Max(0, width - Padding.Left - Padding.Right);
			var innerHeight = Math.Max(0, height - Padding.Top - Padding.Bottom);

			var tx = innerLeft + (innerWidth - childBounds.Width) / 2.0 - childBounds.MinX;
			var ty = innerBottom + (innerHeight - childBounds.Height) / 2.0 - childBounds.MinY;

			if (Math.Abs(tx) < 1e-12 && Math.Abs(ty) < 1e-12)
			{
				children.Add(resolvedChild);
			}
			else
			{
				children.Add(new GroupElement
				{
					Transform = Transform.Translate(tx, ty),
					Children = new[] { resolvedChild },
				});
			}
		}
		else if (resolvedChild != null)
		{
			children.Add(resolvedChild);
		}

		// Pin the outer extent: a border inflates path bounds by the half-stroke width, but the
		// frame's geometric size is exactly (width, height).
		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(minX, minY, maxX, maxY),
		};
	}
}
