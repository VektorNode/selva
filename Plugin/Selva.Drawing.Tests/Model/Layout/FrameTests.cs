using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;


namespace Selva.Drawing.Tests.Model.Layout;

public class FrameTests
{
	[Fact]
	public void Frame_grows_around_child_by_padding()
	{
		var frame = new Frame
		{
			Child = Rect(10, 5),
			Padding = Margins.Uniform(2),
			// No border so the bounds match the geometric outline exactly. (When a stroke is
			// set, PathElement bounds inflate by the half-stroke-width — see PathElement
			// for the convention.)
		};
		var b = frame.ComputeBounds();
		Assert.Equal(14, b.Width, 6);
		Assert.Equal(9, b.Height, 6);
	}

	[Fact]
	public void Frame_with_fixed_size_centres_smaller_child()
	{
		var frame = new Frame
		{
			Child = Rect(10, 5),
			Size = new BoundingBox(0, 0, 30, 20),
			// No border for clean geometric assertion; rect path bounds match the size.
		};
		var resolved = (GroupElement)frame.Resolve(new LayoutContext(BoundingBox.Empty));
		var b = resolved.ComputeBounds();
		Assert.Equal(30, b.Width, 6);
		Assert.Equal(20, b.Height, 6);
	}

	[Fact]
	public void Frame_with_no_border_or_background_omits_outline_path()
	{
		var frame = new Frame { Child = Rect(10, 5) };
		var resolved = (GroupElement)frame.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Single(resolved.Children);
		Assert.IsType<PathElement>(resolved.Children[0]);  // the child rect
	}

	[Fact]
	public void Frame_emits_border_path_when_stroked()
	{
		var frame = new Frame { Child = Rect(10, 5), Border = new Stroke { Width = 0.5 } };
		var resolved = (GroupElement)frame.Resolve(new LayoutContext(BoundingBox.Empty));
		// Two children: outline path + child path.
		Assert.Equal(2, resolved.Children.Count);
		var outline = Assert.IsType<PathElement>(resolved.Children[0]);
		Assert.NotNull(outline.Stroke);
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
