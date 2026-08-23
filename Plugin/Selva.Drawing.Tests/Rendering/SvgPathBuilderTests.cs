using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Svg;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering;

public class SvgPathBuilderTests
{
	[Fact]
	public void Empty_path_emits_empty_string()
	{
		Assert.Equal(string.Empty, SvgPathBuilder.Build(Path.Empty));
	}

	[Fact]
	public void Simple_polyline_round_trips()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0)
			.LineTo(10, 0)
			.LineTo(10, 5)
			.Close()
			.Build();

		Assert.Equal("M 0 0 L 10 0 L 10 5 Z", SvgPathBuilder.Build(path));
	}

	[Fact]
	public void Cubic_segment_emits_six_coords()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0)
			.CubicTo(new Point2D(1, 2), new Point2D(3, 4), new Point2D(5, 6))
			.Build();

		Assert.Equal("M 0 0 C 1 2 3 4 5 6", SvgPathBuilder.Build(path));
	}

	[Fact]
	public void Arc_segment_emits_svg_a_command_with_flags()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0)
			.ArcTo(new Point2D(10, 0), 5, 5, 0, largeArc: false, sweepClockwise: true)
			.Build();

		Assert.Equal("M 0 0 A 5 5 0 0 1 10 0", SvgPathBuilder.Build(path));
	}

	[Fact]
	public void Numeric_formatting_uses_invariant_culture_six_decimals()
	{
		// 1/3 should render with up to six decimals, no trailing zero noise.
		var path = new Path.Builder().MoveTo(1.0 / 3.0, -2.5).Build();
		Assert.Equal("M 0.333333 -2.5", SvgPathBuilder.Build(path));
	}
}
