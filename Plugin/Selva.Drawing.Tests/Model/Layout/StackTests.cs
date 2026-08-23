using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class StackTests
{
	[Fact]
	public void Vertical_stack_natural_height_is_sum_of_children_plus_spacing()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 2,
			Children = new[] { Rect(10, 4), Rect(10, 6), Rect(10, 5) },
		};
		var b = stack.ComputeBounds();
		Assert.Equal(19, b.Height, 6);
		Assert.Equal(10, b.Width, 6);
	}

	[Fact]
	public void Horizontal_stack_natural_width_is_sum_of_children_plus_spacing()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Horizontal,
			Spacing = 1,
			Children = new[] { Rect(3, 8), Rect(5, 8), Rect(2, 8) },
		};
		var b = stack.ComputeBounds();
		Assert.Equal(12, b.Width, 6);
		Assert.Equal(8, b.Height, 6);
	}

	[Fact]
	public void Vertical_stack_first_child_top_aligns_with_stack_top()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Children = new[] { Rect(10, 4), Rect(10, 6) },
		};
		var resolved = stack.Resolve(new LayoutContext(BoundingBox.Empty));
		var bounds = resolved.ComputeBounds();
		Assert.Equal(10, bounds.MaxY, 6);
		Assert.Equal(0, bounds.MinY, 6);
	}

	[Fact]
	public void CrossAlign_center_centres_narrow_child_in_widest_track()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			CrossAlign = CrossAlign.Center,
			Children = new DrawElement[] { Rect(10, 2), Rect(4, 2) },
		};
		var resolved = stack.Resolve(new LayoutContext(BoundingBox.Empty));
		var b = resolved.ComputeBounds();
		// Widest child = 10; the 4mm child centers within it, so both stay inside MinX/MaxX.
		Assert.Equal(0, b.MinX, 6);
		Assert.Equal(10, b.MaxX, 6);
	}

	[Fact]
	public void Empty_stack_resolves_to_empty_group()
	{
		var stack = new Stack();
		var resolved = stack.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.IsType<GroupElement>(resolved);
		Assert.Empty(((GroupElement)resolved).Children);
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
