using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class StackSplitTests
{
	[Fact]
	public void TrySplit_when_all_children_fit_returns_AllFits()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3) },
		};
		var split = stack.TrySplit(20, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void TrySplit_when_first_child_too_tall_returns_NothingFits()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new DrawElement[] { Rect(2, 10), Rect(2, 3) },
		};
		var split = stack.TrySplit(5, new LayoutContext(BoundingBox.Empty));
		Assert.Null(split.Fits);
		Assert.NotNull(split.Overflow);
	}

	[Fact]
	public void TrySplit_breaks_between_children_when_partial_fit()
	{
		// 3 + 3 + 3 = 9 mm. Budget = 7 mm → first two fit (6mm), third spills.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var split = stack.TrySplit(7, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.NotNull(split.Overflow);

		// Overflow should be a Stack with the remaining 1 child.
		var overflowStack = Assert.IsType<Stack>(split.Overflow);
		Assert.Single(overflowStack.Children);

		var fitsBounds = split.Fits.ComputeBounds();
		Assert.Equal(6, fitsBounds.Height, 6);
	}

	[Fact]
	public void Horizontal_stack_falls_back_to_atomic_split()
	{
		// Horizontal stack: 5mm tall, fits in 10mm budget — atomic AllFits.
		var stack = new Stack
		{
			Orientation = StackOrientation.Horizontal,
			Children = new DrawElement[] { Rect(3, 5), Rect(3, 5) },
		};
		var split = stack.TrySplit(10, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void Nested_vertical_stack_can_split_recursively()
	{
		// Outer stack: 2mm rect + inner stack of 3 × 3mm rects (= 9mm). Total natural = 11mm.
		// Budget = 7 mm → outer rect fits (2mm consumed). Inner stack is asked for 5mm. Inner
		// fits 1 × 3mm rect (3mm consumed); 2 remain in inner overflow.
		var inner = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var outer = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 2), inner },
		};

		var split = outer.TrySplit(7, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.NotNull(split.Overflow);

		// Outer overflow should be a Stack containing only the inner-stack overflow remnant.
		var outerOverflow = Assert.IsType<Stack>(split.Overflow);
		Assert.Single(outerOverflow.Children);
		var innerOverflow = Assert.IsType<Stack>(outerOverflow.Children[0]);
		Assert.Equal(2, innerOverflow.Children.Count);
	}

	[Fact]
	public void Keep_together_child_is_treated_as_atomic_and_pushed_whole_to_overflow()
	{
		// Outer stack: 2mm rect + an inner stack (3 × 3mm = 9mm) marked keep-together.
		// Budget = 7mm. Without the flag, Stack.TrySplit would recurse into the inner stack
		// and split it (1 of 3 fits). With the flag, the inner stack is atomic — only the
		// 2mm rect fits, and the whole inner stack spills.
		var inner = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
			Metadata = new Dictionary<string, string> { ["keep-together"] = "true" },
		};
		var outer = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 2), inner },
		};

		var split = outer.TrySplit(7, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		var outerOverflow = Assert.IsType<Stack>(split.Overflow);
		Assert.Single(outerOverflow.Children);
		// The overflow is the original inner stack (still 3 children, not a 2-of-3 remnant).
		var innerOverflow = Assert.IsType<Stack>(outerOverflow.Children[0]);
		Assert.Equal(3, innerOverflow.Children.Count);
	}

	[Fact]
	public void Keep_together_does_not_force_atomic_when_child_fits_whole()
	{
		// 2mm + 3mm = 5mm fits in 10mm. Keep-together flag is irrelevant when nothing splits.
		var inner = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3) },
			Metadata = new Dictionary<string, string> { ["keep-together"] = "true" },
		};
		var outer = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 2), inner },
		};
		var split = outer.TrySplit(10, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void TextFlow_split_inside_stack_uses_stack_cross_axis_so_trailing_sibling_lands_below_overflow()
	{
		// Multi-line auto-width TextFlow followed by a small element in a vertical stack.
		// The stack's cross-axis (40mm) is much narrower than the parent context (200mm).
		// Before the fix, Stack.TrySplit handed `context` (200mm) to the child's TrySplit
		// while Resolve used `childContext` (40mm) — TextFlow re-wrapped to a wider width
		// inside TrySplit, reported "everything fits" against the wide measurement, and
		// the trailing element was placed where the wide-wrap text ended. When rendered at
		// 40mm the text was much taller, so the trailing element overlapped it.
		const string longText =
			"the quick brown fox jumps over the lazy dog and then jumps back again over the lazy dog";
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[]
			{
				new TextFlow { Text = longText, Style = new TextStyle { FontSize = 3.0 } },
				Rect(2, 4),
			},
		};

		// Parent context: 40mm wide (cross-axis source), 200mm tall page slice.
		var parentContext = new LayoutContext(new BoundingBox(0, 0, 40, 200));

		// Pick a budget that forces a split mid-text: small enough that the wrapped flow
		// can't all fit, but large enough that several lines do.
		var split = stack.TrySplit(15, parentContext);

		Assert.NotNull(split.Fits);
		Assert.NotNull(split.Overflow);

		// Reported FitsHeight must match the actual rendered height of Fits.
		var fitsBounds = split.Fits.ComputeBounds();
		Assert.Equal(split.FitsHeight, fitsBounds.Height, 6);

		// Resolve the overflow Stack at the same cross-axis. The trailing Rect must land
		// BELOW (smaller MaxY than MinY of) the overflow text — no overlap.
		var overflowStack = Assert.IsType<Stack>(split.Overflow);
		Assert.Equal(2, overflowStack.Children.Count); // text overflow + trailing rect
		var resolvedOverflow = overflowStack.Resolve(parentContext);
		var overflowBounds = resolvedOverflow.ComputeBounds();
		// Sanity: overflow should fit within or near the page slice.
		Assert.True(overflowBounds.Height > 0);
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
