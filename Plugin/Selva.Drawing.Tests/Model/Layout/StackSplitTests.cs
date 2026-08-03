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
		// 3 + 3 + 3 = 9mm, budget 7mm → first two fit (6mm), third spills.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var split = stack.TrySplit(7, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.NotNull(split.Overflow);

		var overflowStack = Assert.IsType<Stack>(split.Overflow);
		Assert.Single(overflowStack.Children);

		var fitsBounds = split.Fits.ComputeBounds();
		Assert.Equal(6, fitsBounds.Height, 6);
	}

	[Fact]
	public void Horizontal_stack_falls_back_to_atomic_split()
	{
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
		// Outer: 2mm rect + inner stack of 3×3mm rects. Budget 7mm → outer rect fits (2mm),
		// inner stack gets the remaining 5mm and fits 1 of its 3 rects, 2 spill to overflow.
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

		var outerOverflow = Assert.IsType<Stack>(split.Overflow);
		Assert.Single(outerOverflow.Children);
		var innerOverflow = Assert.IsType<Stack>(outerOverflow.Children[0]);
		Assert.Equal(2, innerOverflow.Children.Count);
	}

	[Fact]
	public void Keep_together_child_is_treated_as_atomic_and_pushed_whole_to_overflow()
	{
		// Outer: 2mm rect + inner stack (3×3mm) marked keep-together. Budget 7mm: without the
		// flag TrySplit would recurse into inner and split it; with the flag inner is atomic,
		// so only the 2mm rect fits and the whole inner stack spills.
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
		var innerOverflow = Assert.IsType<Stack>(outerOverflow.Children[0]);
		Assert.Equal(3, innerOverflow.Children.Count);
	}

	[Fact]
	public void Keep_together_does_not_force_atomic_when_child_fits_whole()
	{
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
		// Stack.TrySplit used to hand the child TrySplit the parent's full-width context (200mm)
		// while Resolve used the stack's narrower cross-axis (40mm). TextFlow re-wrapped wider
		// inside TrySplit, under-reported its height, and the trailing element ended up placed
		// where the wide-wrap text ended — then overlapped it once rendered at 40mm.
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

		var parentContext = new LayoutContext(new BoundingBox(0, 0, 40, 200));

		// Small enough that the wrapped flow can't all fit, large enough that several lines do.
		var split = stack.TrySplit(15, parentContext);

		Assert.NotNull(split.Fits);
		Assert.NotNull(split.Overflow);

		var fitsBounds = split.Fits.ComputeBounds();
		Assert.Equal(split.FitsHeight, fitsBounds.Height, 6);

		var overflowStack = Assert.IsType<Stack>(split.Overflow);
		Assert.Equal(2, overflowStack.Children.Count); // text overflow + trailing rect
		var resolvedOverflow = overflowStack.Resolve(parentContext);
		var overflowBounds = resolvedOverflow.ComputeBounds();
		Assert.True(overflowBounds.Height > 0);
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
