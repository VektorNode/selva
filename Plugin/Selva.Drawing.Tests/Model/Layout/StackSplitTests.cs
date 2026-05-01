using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
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

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
