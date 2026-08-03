using System;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Tests.Model;

public class TransformTests
{
	[Fact]
	public void Identity_leaves_points_unchanged()
	{
		var t = Transform.Identity;
		var p = new Point2D(3, 4);
		Assert.Equal(p, t.Apply(p));
		Assert.True(t.IsIdentity);
	}

	[Fact]
	public void Translate_shifts_origin()
	{
		var t = Transform.Translate(10, 20);
		var p = t.Apply(new Point2D(1, 2));
		Assert.Equal(11, p.X);
		Assert.Equal(22, p.Y);
	}

	[Fact]
	public void Scale_scales_each_axis()
	{
		var t = Transform.Scale(2, 3);
		var p = t.Apply(new Point2D(4, 5));
		Assert.Equal(8, p.X);
		Assert.Equal(15, p.Y);
	}

	[Fact]
	public void Rotate_90_degrees_maps_x_axis_to_y_axis()
	{
		var t = Transform.RotateDegrees(90);
		var p = t.Apply(new Point2D(1, 0));
		Assert.Equal(0, Math.Round(p.X, 9));
		Assert.Equal(1, Math.Round(p.Y, 9));
	}

	[Fact]
	public void Multiply_composes_in_function_order()
	{
		// translate.Then(scale) applies translate first, then scale: scale(translate(p)).
		var translate = Transform.Translate(10, 0);
		var scale = Transform.Scale(2);
		var composed = translate.Then(scale);

		var p = composed.Apply(new Point2D(3, 4));
		// scale(translate(3,4)) = scale(13,4) = (26,8)
		Assert.Equal(26, p.X);
		Assert.Equal(8, p.Y);
	}
}
