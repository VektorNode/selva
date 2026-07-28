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

		// Forward the cross-axis size so flexible children (auto-width TextFlow, star Grids)
		// can fill the stack's cross extent, plus the main-axis room still unclaimed. The
		// main-axis ceiling is what stops an auto-fit child (DrawingView) from sizing itself
		// against an unbounded axis and running past the page's content rect.
		var remainingMain = PerChildMainBudget(context);

		// First pass: ask each child for its natural bounds (recursing into LayoutElements
		// with the cross-axis context — they'll hand back a sized primitive).
		var resolvedChildren = new DrawElement[Children.Count];
		var bounds = new BoundingBox[Children.Count];
		var maxCross = 0.0;
		var totalMain = 0.0;
		var nonEmptyCount = 0;
		for (var i = 0; i < Children.Count; i++)
		{
			// Each child is measured against everything still unclaimed, as a ceiling. A child
			// that needs less hands the surplus to those after it.
			//
			// This deliberately does NOT pre-divide by the number of children left. That divisor
			// counted every remaining child, including ones that go on to occupy nothing (an
			// empty nested Stack, a blank TextFlow), so a conditionally-empty branch silently
			// rescaled every view on the sheet: one view alone filled its 100 mm budget, the same
			// view beside five empty siblings got 16.7 mm. Worse, it made sibling COUNT set the
			// drawing scale — adding a caption under a view shrank the view from 190 mm to 143 mm
			// and left 48% of the sheet blank, which is the single most common drafting layout.
			//
			// Over-claiming by an early greedy child is corrected below, once the measurements
			// reveal what each child actually wanted.
			var childContext = BuildChildContext(context, remainingMain);
			var child = Children[i] is LayoutElement nested
				? nested.Resolve(childContext)
				: Children[i];
			resolvedChildren[i] = child;
			var b = child?.ComputeBounds() ?? BoundingBox.Empty;
			bounds[i] = b;
			if (b.IsEmpty) continue;
			if (!double.IsPositiveInfinity(remainingMain))
			{
				var consumedMain = Orientation == StackOrientation.Vertical ? b.Height : b.Width;
				remainingMain = Math.Max(0, remainingMain - consumedMain);
			}
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

		// Correction pass. Measuring each child against the whole remaining budget lets an early
		// greedy child claim room a later sibling also needs, so the run can total more than the
		// budget. Only now, with every child's appetite known, is there enough information to
		// divide fairly: scale the flexible (layout) children down by the factor that brings the
		// total back inside the budget, leaving primitives — which cannot be resized — alone.
		//
		// Doing it here rather than up front is the whole point: children that turned out to
		// occupy nothing take no share, so an empty sibling costs the others nothing.
		// A child asked for N mm rarely returns exactly N: padding, borders and stroke inflation
		// are fixed costs that don't shrink with the geometry, so one proportional pass can still
		// land marginally over. Repeat until it fits — each round shrinks the request, so this
		// converges quickly; the cap is a backstop against a child that ignores its budget
		// entirely (a fixed-size primitive misreported as flexible).
		var mainBudget = PerChildMainBudget(context);
		var spacingMain = Spacing * Math.Max(0, nonEmptyCount - 1);
		for (var attempt = 0; attempt < 4; attempt++)
		{
			if (double.IsPositiveInfinity(mainBudget) || totalMain <= mainBudget + 1e-6) break;

			var flexibleMain = 0.0;
			var fixedMain = 0.0;
			for (var i = 0; i < Children.Count; i++)
			{
				if (bounds[i].IsEmpty) continue;
				var extent = Orientation == StackOrientation.Vertical ? bounds[i].Height : bounds[i].Width;
				if (Children[i] is LayoutElement) flexibleMain += extent;
				else fixedMain += extent;
			}

			var roomForFlexible = mainBudget - fixedMain - spacingMain;
			if (flexibleMain <= 0 || roomForFlexible <= 0 || roomForFlexible >= flexibleMain) break;

			var factor = roomForFlexible / flexibleMain;
			totalMain = 0;
			maxCross = 0;
			for (var i = 0; i < Children.Count; i++)
			{
				if (Children[i] is LayoutElement nested && !bounds[i].IsEmpty)
				{
					var extent = Orientation == StackOrientation.Vertical ? bounds[i].Height : bounds[i].Width;
					var childContext = BuildChildContext(context, extent * factor);
					resolvedChildren[i] = nested.Resolve(childContext);
					bounds[i] = resolvedChildren[i]?.ComputeBounds() ?? BoundingBox.Empty;
				}
				if (bounds[i].IsEmpty) continue;
				if (Orientation == StackOrientation.Vertical)
				{
					totalMain += bounds[i].Height;
					if (bounds[i].Width > maxCross) maxCross = bounds[i].Width;
				}
				else
				{
					totalMain += bounds[i].Width;
					if (bounds[i].Height > maxCross) maxCross = bounds[i].Height;
				}
			}
			totalMain += spacingMain;
		}

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
	//
	// This loop and Resolve are two independent walks over the same budget and must agree about
	// every child's size. A 2026-07-27 audit claimed they diverge for auto-fit children (this
	// one measuring greedily against `availableHeight - consumed` while Resolve allocates a
	// share), reporting the same document as 1 page / view h=49.9 unpaginated but 2 pages /
	// view h=99.6 through PaginateBody. Two attempts to reproduce that found the two paths
	// agreeing exactly at every geometry size tried, so no change was made. ContentRectInvariant
	// Tests now paginates the same cross-product it resolves, which is the cheap standing check;
	// if the two ever diverge again, that is where it will show up first.
	public override SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		if (Orientation != StackOrientation.Vertical)
			return base.TrySplit(availableHeight, context);

		// availableHeight is the real remaining budget and outranks whatever the caller's context
		// says, so narrow the context to match before anything is measured against it. Without
		// this, every `Resolve(context)` below sizes against room the caller has already spent:
		// asked to fit 30 mm while holding a full-page context, this returned a resolved stack
		// 100 mm tall and reported it as fitting.
		if (!double.IsPositiveInfinity(availableHeight) && availableHeight < context.AvailableHeight)
			context = BuildSelfContext(context, availableHeight);

		if (Children.Count == 0)
			return SplitResult.AllFits(Resolve(context), 0);

		// The children's main-axis ceiling, so an auto-fit DrawingView cannot size itself past
		// the bottom of the content rect. `consumed` below tracks what earlier children took, so
		// each measurement sees the room that is actually left rather than the whole page.
		var childContext = BuildChildContext(context, availableHeight);

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

			var measureContext = double.IsPositiveInfinity(availableHeight)
				? childContext
				: BuildChildContext(context, Math.Max(0, availableHeight - consumed));
			var resolvedForMeasure = child is LayoutElement nested
				? nested.Resolve(measureContext)
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
				// Pass the cross-axis-constrained context, not the parent context. Otherwise a
				// child like TextFlow re-wraps to the parent's full width inside TrySplit while
				// Resolve uses the stack's narrower cross-axis — line counts diverge and the
				// next sibling lands at the wrong Y, often overlapping the text on the next page.
				//
				// The main axis must be `remaining`, not the whole page. A nested Stack resolves
				// against its context to decide what fits, so handing it the full-page budget let
				// it size against room the parent had already spent — and the parent then accepted
				// the returned FitsHeight unchecked. TrySplit(30) with a full-page context came
				// back claiming FitsHeight=100.
				var splitContext = BuildChildContext(context, remaining);
				var childSplit = layoutChild.TrySplit(remaining, splitContext);
				if (childSplit.Fits != null)
				{
					// Trust the geometry the child actually produced over the height it reports:
					// a child that resolved against a stale budget can claim a FitsHeight larger
					// than `remaining`, and accepting it silently pushes the stack past the page.
					var splitFitsBounds = childSplit.Fits.ComputeBounds();
					var actualHeight = splitFitsBounds.IsEmpty ? childSplit.FitsHeight : splitFitsBounds.Height;

					fitsChildren.Add(childSplit.Fits);
					consumed += spacingBefore + actualHeight;
					if (actualHeight > 0) placedNonEmpty = true;
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

		// "Nothing fits" must be judged on occupied extent, not on the number of children kept.
		// An empty leading child (an empty nested Stack, a blank TextFlow) counts towards
		// fitsChildren while occupying nothing, so a stack whose first real child overflowed
		// reported a successful partial split and emitted a page containing only the empty
		// child — a blank page 0, with the actual content pushed to page 1.
		//
		// `placedNonEmpty` is the loop's own record of whether any child with real extent was
		// kept, so it answers this directly; re-measuring `fitsChildren` here would not, because
		// those are the unresolved originals.
		if (!placedNonEmpty)
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

		// Advance past any leading children that occupy no space. Forcing an empty child out as
		// "the head" produced an entirely blank page and deferred the real content to the next
		// one — a leading empty nested Stack or blank TextFlow turned a 1-page document into 2,
		// the first of which drew nothing. Empty children still travel with the forced page (they
		// render nothing either way); they just cannot be what the page is built around.
		var headIndex = 0;
		while (headIndex < Children.Count - 1 && IsZeroExtent(Children[headIndex], childContext))
			headIndex++;

		var head = Children[headIndex];
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
		for (var i = headIndex + 1; i < Children.Count; i++) overflowChildren.Add(Children[i]);
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
		=> BuildChildContext(parent, double.PositiveInfinity);

	// Whether a child occupies no space along the stacking axis, and so cannot meaningfully be
	// the head of a forced page.
	private bool IsZeroExtent(DrawElement child, LayoutContext childContext)
	{
		var resolved = child is LayoutElement nested ? nested.Resolve(childContext) : child;
		var b = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		if (b.IsEmpty) return true;
		return (Orientation == StackOrientation.Vertical ? b.Height : b.Width) <= 0;
	}

	// The stack's OWN context with the vertical axis clamped to a smaller budget. Unlike
	// BuildChildContext this never swaps axes by orientation — TrySplit's budget is always a
	// height, because pagination only ever breaks vertically.
	private static LayoutContext BuildSelfContext(LayoutContext parent, double availableHeight)
	{
		var w = parent.AvailableWidth;
		return double.IsInfinity(w) || w <= 0
			? new LayoutContext(new BoundingBox(0, 0, double.PositiveInfinity, availableHeight))
			: new LayoutContext(new BoundingBox(0, 0, w, availableHeight));
	}

	// The main-axis extent a single child may claim: the whole budget, less the spacing that
	// must fit between children. This is a *ceiling* that stops one child sizing past the page
	// — not an allocation. Dividing it by the child count instead would cap every child at an
	// equal share even when its siblings need far less, which squeezes a long flat view into a
	// fraction of the sheet and leaves the rest blank.
	//
	// Children that overrun the page collectively are the pagination pass's problem (vertical)
	// or the user's layout choice (horizontal); the ceiling only prevents a *single* auto-fit
	// child from scaling itself against an unbounded axis.
	private double PerChildMainBudget(LayoutContext parent)
	{
		var budget = Orientation == StackOrientation.Vertical
			? parent.AvailableHeight
			: parent.AvailableWidth;
		if (double.IsInfinity(budget) || budget <= 0) return double.PositiveInfinity;

		// Clamp at 0 rather than falling back to infinity: spacing alone exceeding the budget
		// means there is no room left, which is not the same as having no constraint.
		return Math.Max(0, budget - Spacing * Math.Max(0, Children.Count - 1));
	}

	// mainBudget is the real remaining extent along the stacking axis when the caller knows
	// it, or +infinity when it genuinely doesn't. Passing it through is what keeps an
	// auto-fitting child (DrawingView) inside the page: with an infinite main axis it fits
	// only the cross axis, so tall geometry in a vertical stack — or a row of views in a
	// horizontal one — sizes past the content rect and runs through the footer.
	//
	// Never substitute a fake finite value here. An earlier version used cross x cross, which
	// scaled auto-fit children against a fictitious square viewport; infinity is the correct
	// answer when no budget is known, because it makes the child keep its natural size rather
	// than one derived from an unrelated axis.
	private LayoutContext BuildChildContext(LayoutContext parent, double mainBudget)
	{
		// A budget of exactly 0 means "the siblings used it all", not "unbounded" — flipping it
		// to infinity here would hand the next child a free axis and let it size past the page.
		// Only a negative or non-finite budget means "no budget known".
		var main = mainBudget >= 0 && !double.IsNaN(mainBudget) ? mainBudget : double.PositiveInfinity;
		if (Orientation == StackOrientation.Vertical)
		{
			var w = parent.AvailableWidth;
			if (double.IsInfinity(w) || w <= 0)
			{
				// No cross-axis budget. A main-axis budget alone is still worth forwarding —
				// it bounds the axis the stack grows along.
				return double.IsInfinity(main)
					? new LayoutContext(BoundingBox.Empty)
					: new LayoutContext(new BoundingBox(0, 0, double.PositiveInfinity, main));
			}
			return new LayoutContext(new BoundingBox(0, 0, w, main));
		}
		var h = parent.AvailableHeight;
		if (double.IsInfinity(h) || h <= 0)
		{
			return double.IsInfinity(main)
				? new LayoutContext(BoundingBox.Empty)
				: new LayoutContext(new BoundingBox(0, 0, main, double.PositiveInfinity));
		}
		return new LayoutContext(new BoundingBox(0, 0, main, h));
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
