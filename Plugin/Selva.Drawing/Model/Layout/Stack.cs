using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

public enum StackOrientation { Vertical, Horizontal }

// How children are aligned along the cross axis (perpendicular to the stack direction).
public enum CrossAlign { Start, Center, End, Stretch }

// Phase 7: vertical or horizontal sequence of children with uniform spacing and a single
// cross-axis alignment. Children are positioned by translating each child's bounding box;
// the natural size of the stack is the sum of child sizes along the main axis plus
// (Children.Count - 1) × Spacing, by the max child cross size.
//
// Anchor: by default the stack's bottom-left sits at world origin (0,0). Wrap in a
// GroupElement with a Transform if you want a different position.
//
// Vertical orientation grows the stack downwards from its anchor (Y-up world coords:
// the first child's TOP aligns with the stack's top). Horizontal grows rightwards.
public sealed class Stack : LayoutElement
{
	public IReadOnlyList<DrawElement> Children { get; init; } = Array.Empty<DrawElement>();
	public StackOrientation Orientation { get; init; } = StackOrientation.Vertical;
	public double Spacing { get; init; } = 0.0;
	public CrossAlign CrossAlign { get; init; } = CrossAlign.Start;

	// Origin of the stack in world coords (anchor of the bottom-left corner of the bounding
	// box). Defaults to (0,0).
	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		if (Children.Count == 0)
			return new GroupElement { Id = Id, CssClass = CssClass, Metadata = Metadata };

		// Forward the cross-axis size so flexible children (auto-width TextFlow, star
		// Grids) can fill the stack's cross extent. Main axis is left unconstrained —
		// the stack sums children along it.
		var childContext = BuildChildContext(context);

		// First pass: ask each child for its natural bounds (recursing into LayoutElements
		// with the cross-axis context — they'll hand back a sized primitive).
		var resolvedChildren = new DrawElement[Children.Count];
		var bounds = new BoundingBox[Children.Count];
		var maxCross = 0.0;
		var totalMain = 0.0;
		var nonEmptyCount = 0;
		for (var i = 0; i < Children.Count; i++)
		{
			var child = Children[i] is LayoutElement nested
				? nested.Resolve(childContext)
				: Children[i];
			resolvedChildren[i] = child;
			var b = child?.ComputeBounds() ?? BoundingBox.Empty;
			bounds[i] = b;
			if (b.IsEmpty) continue;
			nonEmptyCount++;
			if (Orientation == StackOrientation.Vertical)
			{
				totalMain += b.Height;
				if (b.Width > maxCross) maxCross = b.Width;
			}
			else
			{
				totalMain += b.Width;
				if (b.Height > maxCross) maxCross = b.Height;
			}
		}
		// Spacing only between children that occupy space — the placement loop below skips
		// empty children entirely, so counting them here would shift content off the anchor.
		totalMain += Spacing * Math.Max(0, nonEmptyCount - 1);

		// Stretch alignment: if the parent provides a finite cross-axis and we'd otherwise
		// pick a smaller maxCross, expand to fill. Layout-element children already filled
		// to the same width via childContext; primitive children stay their natural size
		// but row width matches the parent. (Primitives can't be resized — they keep their
		// authored geometry; alignment falls back to Start for them.)
		if (CrossAlign == CrossAlign.Stretch)
		{
			var parentCross = Orientation == StackOrientation.Vertical
				? context.AvailableWidth
				: context.AvailableHeight;
			if (!double.IsInfinity(parentCross) && parentCross > maxCross)
				maxCross = parentCross;
		}

		// Lay out: vertical stack pins child i so its TOP edge is `cursor` mm below the
		// stack's top. Stack's top sits at (Origin.Y + totalMain) in world Y. Cross axis
		// position uses CrossAlign against maxCross.
		var laidOut = new List<DrawElement>(Children.Count);
		var cursor = 0.0;
		for (var i = 0; i < resolvedChildren.Length; i++)
		{
			var child = resolvedChildren[i];
			if (child == null) continue;
			var b = bounds[i];
			if (b.IsEmpty)
			{
				laidOut.Add(child);
				continue;
			}

			double tx, ty;
			if (Orientation == StackOrientation.Vertical)
			{
				// Cross is X. Child's natural left = b.MinX; we want it positioned at
				// (Origin.X + crossOffset). Main is Y, growing downward from top.
				var crossOffset = ResolveCrossOffset(b.Width, maxCross);
				tx = Origin.X + crossOffset - b.MinX;
				// Top of stack = Origin.Y + totalMain. Top of this child = top - cursor.
				// child.b.MaxY should land at (top - cursor), so ty shifts by (top - cursor) - b.MaxY.
				ty = Origin.Y + totalMain - cursor - b.MaxY;
				cursor += b.Height + Spacing;
			}
			else
			{
				// Cross is Y. Main is X, growing rightward from left.
				var crossOffset = ResolveCrossOffset(b.Height, maxCross);
				ty = Origin.Y + crossOffset - b.MinY;
				// Left edge of child lands at (Origin.X + cursor). child.b.MinX → that.
				tx = Origin.X + cursor - b.MinX;
				cursor += b.Width + Spacing;
			}

			laidOut.Add(WrapInTranslate(child, tx, ty));
		}

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = laidOut,
		};
	}

	// Pagination: vertical stacks can break between children. Walk children top-down
	// accumulating until the next one would overflow; if that child is itself a layout
	// element we recurse into its TrySplit so a tall nested Stack/Table can also split.
	// Horizontal stacks fall back to the atomic default (whole-stack-or-nothing).
	public override SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		if (Orientation != StackOrientation.Vertical)
			return base.TrySplit(availableHeight, context);

		if (Children.Count == 0)
			return SplitResult.AllFits(Resolve(context), 0);

		var childContext = BuildChildContext(context);

		var fitsChildren = new List<DrawElement>();
		var overflowChildren = new List<DrawElement>();
		var consumed = 0.0;
		var splitDone = false;
		var placedNonEmpty = false;

		for (var i = 0; i < Children.Count; i++)
		{
			var child = Children[i];
			if (splitDone)
			{
				overflowChildren.Add(child);
				continue;
			}

			var resolvedForMeasure = child is LayoutElement nested
				? nested.Resolve(childContext)
				: child;
			var b = resolvedForMeasure?.ComputeBounds() ?? BoundingBox.Empty;
			var h = b.IsEmpty ? 0 : b.Height;
			// Mirror Resolve's accounting: spacing applies only between non-empty children.
			var spacingBefore = placedNonEmpty && !b.IsEmpty ? Spacing : 0;

			if (consumed + spacingBefore + h <= availableHeight + 1e-6)
			{
				fitsChildren.Add(child);
				consumed += spacingBefore + h;
				if (!b.IsEmpty) placedNonEmpty = true;
				continue;
			}

			// This child doesn't fit whole. Ask it to split if it's a layout element with
			// remaining budget left after accounting for inter-child spacing.
			// Honour the "keep-together" metadata hint: a child marked keep-together is
			// treated atomically — push it whole to overflow rather than recursing into
			// its TrySplit. Useful for "title + first paragraph" groups that must stay on
			// the same page as a unit.
			var remaining = availableHeight - consumed - spacingBefore;
			if (remaining > 0 && child is LayoutElement layoutChild && !IsKeepTogether(child))
			{
				// Pass the cross-axis-constrained childContext, not the parent context. Otherwise
				// a child like TextFlow re-wraps to the parent's full width inside TrySplit while
				// Resolve uses the stack's narrower cross-axis — line counts diverge and the
				// next sibling lands at the wrong Y, often overlapping the text on the next page.
				var childSplit = layoutChild.TrySplit(remaining, childContext);
				if (childSplit.Fits != null)
				{
					fitsChildren.Add(childSplit.Fits);
					consumed += spacingBefore + childSplit.FitsHeight;
					if (childSplit.Overflow != null) overflowChildren.Add(childSplit.Overflow);
					splitDone = true;
					continue;
				}
			}

			overflowChildren.Add(child);
			splitDone = true;
		}

		if (overflowChildren.Count == 0)
		{
			var resolved = Resolve(context);
			var rb = resolved?.ComputeBounds() ?? BoundingBox.Empty;
			return SplitResult.AllFits(resolved, rb.IsEmpty ? 0 : rb.Height);
		}

		if (fitsChildren.Count == 0)
			return SplitResult.NothingFits(this);

		var fitsStack = new Stack
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Orientation = Orientation,
			Spacing = Spacing,
			CrossAlign = CrossAlign,
			Origin = Origin,
			Children = fitsChildren,
		};
		var overflowStack = new Stack
		{
			Orientation = Orientation,
			Spacing = Spacing,
			CrossAlign = CrossAlign,
			Origin = Point2D.Zero,
			Children = overflowChildren,
		};

		var fitsResolved = fitsStack.Resolve(context);
		var fitsBounds = fitsResolved?.ComputeBounds() ?? BoundingBox.Empty;
		var fitsHeight = fitsBounds.IsEmpty ? consumed : fitsBounds.Height;
		return SplitResult.Partial(fitsResolved, overflowStack, fitsHeight);
	}

	// Nothing fits on a fresh page: shed only the head child (letting a splittable head —
	// a tall TextFlow, a Table — shed its own leading fragment first) so the oversize page
	// carries as little as possible and pagination continues with the rest.
	public override SplitResult ForcePlace(double availableHeight, LayoutContext context)
	{
		if (Orientation != StackOrientation.Vertical || Children.Count == 0)
			return base.ForcePlace(availableHeight, context);

		var childContext = BuildChildContext(context);
		var head = Children[0];
		DrawElement headFits;
		DrawElement headOverflow = null;
		if (head is LayoutElement headLayout && !IsKeepTogether(head))
		{
			var forced = headLayout.ForcePlace(availableHeight, childContext);
			headFits = forced.Fits;
			headOverflow = forced.Overflow;
		}
		else
		{
			headFits = head;
		}

		var fitsStack = new Stack
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Orientation = Orientation,
			Spacing = Spacing,
			CrossAlign = CrossAlign,
			Origin = Origin,
			Children = new[] { headFits },
		};
		var fitsResolved = fitsStack.Resolve(context);
		var fitsBounds = fitsResolved?.ComputeBounds() ?? BoundingBox.Empty;
		var fitsHeight = fitsBounds.IsEmpty ? 0 : fitsBounds.Height;

		var overflowChildren = new List<DrawElement>(Children.Count);
		if (headOverflow != null) overflowChildren.Add(headOverflow);
		for (var i = 1; i < Children.Count; i++) overflowChildren.Add(Children[i]);
		if (overflowChildren.Count == 0)
			return SplitResult.AllFits(fitsResolved, fitsHeight);

		var overflowStack = new Stack
		{
			Orientation = Orientation,
			Spacing = Spacing,
			CrossAlign = CrossAlign,
			Origin = Point2D.Zero,
			Children = overflowChildren,
		};
		return SplitResult.Partial(fitsResolved, overflowStack, fitsHeight);
	}

	// Build the per-child context: cross-axis = parent's available cross-axis size,
	// main axis = unbounded. The infinite main axis matters: a finite fake value (the old
	// behaviour used cross × cross) made auto-fit children (DrawingView) scale against a
	// fictitious square viewport. Children that split read their height budget from
	// TrySplit, never from this context.
	private LayoutContext BuildChildContext(LayoutContext parent)
	{
		if (Orientation == StackOrientation.Vertical)
		{
			var w = parent.AvailableWidth;
			if (double.IsInfinity(w) || w <= 0) return new LayoutContext(BoundingBox.Empty);
			return new LayoutContext(new BoundingBox(0, 0, w, double.PositiveInfinity));
		}
		var h = parent.AvailableHeight;
		if (double.IsInfinity(h) || h <= 0) return new LayoutContext(BoundingBox.Empty);
		return new LayoutContext(new BoundingBox(0, 0, double.PositiveInfinity, h));
	}

	// Keep-together flag lives in DrawElement.Metadata under "keep-together". Truthy
	// values: "true", "1", "yes" (case-insensitive). Anything else is false.
	internal static bool IsKeepTogether(DrawElement element)
	{
		var md = element?.Metadata;
		if (md == null) return false;
		if (!md.TryGetValue("keep-together", out var v) || v == null) return false;
		return v.Equals("true", StringComparison.OrdinalIgnoreCase)
			|| v.Equals("1", StringComparison.Ordinal)
			|| v.Equals("yes", StringComparison.OrdinalIgnoreCase);
	}

	private double ResolveCrossOffset(double naturalCross, double maxCross)
	{
		switch (CrossAlign)
		{
			case CrossAlign.Center: return (maxCross - naturalCross) / 2.0;
			case CrossAlign.End: return maxCross - naturalCross;
			case CrossAlign.Stretch:
			case CrossAlign.Start:
			default:
				return 0;
		}
	}

	private static DrawElement WrapInTranslate(DrawElement child, double tx, double ty)
	{
		if (Math.Abs(tx) < 1e-12 && Math.Abs(ty) < 1e-12) return child;
		return new GroupElement
		{
			Transform = Transform.Translate(tx, ty),
			Children = new[] { child },
		};
	}
}
