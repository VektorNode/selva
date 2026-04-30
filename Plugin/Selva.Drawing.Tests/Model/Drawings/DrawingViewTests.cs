using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Drawings;

public class DrawingViewTests
{
	[Fact]
	public void Empty_view_resolves_to_group()
	{
		var view = new DrawingView();
		var resolved = (GroupElement)view.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
	}

	[Fact]
	public void View_natural_size_is_geometry_times_scale_plus_padding()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(100, 50).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Scale = 0.5,
			Padding = Margins.Uniform(5),
		};
		var b = view.ComputeBounds();
		// Geometry path is 100×50; scaled by 0.5 = 50×25; +10×10 padding = 60×35.
		// Stroke half-width on the inner geometry inflates the path bounds by ±0.125 each.
		// Frame border is null, so outer width is exactly 50+10 = 60 mm wide.
		Assert.Equal(60, b.Width, 1);
		Assert.Equal(35, b.Height, 1);
	}

	[Fact]
	public void Fixed_size_view_pins_outer_bounds()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(10, 10).Build(),
		};
		var view = new DrawingView
		{
			Geometry = geometry,
			Size = new BoundingBox(0, 0, 80, 50),
			Padding = Margins.Uniform(2),
		};
		var b = view.ComputeBounds();
		Assert.Equal(80, b.Width, 6);
		Assert.Equal(50, b.Height, 6);
	}

	[Fact]
	public void View_with_caption_grows_below_origin()
	{
		var geometry = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(20, 20).Build(),
		};
		var withCaption = new DrawingView
		{
			Geometry = geometry,
			Caption = "SCALE 1:5",
			Padding = Margins.Uniform(2),
		};
		var withoutCaption = new DrawingView
		{
			Geometry = geometry,
			Padding = Margins.Uniform(2),
		};
		var bWith = withCaption.ComputeBounds();
		var bWithout = withoutCaption.ComputeBounds();
		Assert.True(bWith.Height > bWithout.Height);
		// Caption sits below Origin.Y (0), so MinY < 0 with caption.
		Assert.True(bWith.MinY < 0);
	}

	[Fact]
	public void Format_scale_label_handles_common_ratios()
	{
		Assert.Equal("SCALE 1:1", DrawingView.FormatScaleLabel(1.0));
		Assert.Equal("SCALE 1:5", DrawingView.FormatScaleLabel(0.2));
		Assert.Equal("SCALE 1:10", DrawingView.FormatScaleLabel(0.1));
		Assert.Equal("SCALE 2:1", DrawingView.FormatScaleLabel(2.0));
	}
}
