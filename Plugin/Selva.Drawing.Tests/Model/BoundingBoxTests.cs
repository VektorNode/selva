using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Tests.Model;

public class BoundingBoxTests
{
	[Fact]
	public void Empty_is_invalid_and_zero_sized()
	{
		var b = BoundingBox.Empty;
		Assert.False(b.IsValid);
		Assert.True(b.IsEmpty);
		Assert.Equal(0, b.Width);
		Assert.Equal(0, b.Height);
	}

	[Fact]
	public void Union_with_empty_is_identity()
	{
		var b = new BoundingBox(0, 0, 10, 10);
		Assert.Equal(b, b.Union(BoundingBox.Empty));
		Assert.Equal(b, BoundingBox.Empty.Union(b));
	}

	[Fact]
	public void FromCorners_normalizes_min_max()
	{
		var b = BoundingBox.FromCorners(new Point2D(5, 7), new Point2D(1, 2));
		Assert.Equal(1, b.MinX);
		Assert.Equal(2, b.MinY);
		Assert.Equal(5, b.MaxX);
		Assert.Equal(7, b.MaxY);
	}

	[Fact]
	public void Union_takes_outer_extents()
	{
		var a = new BoundingBox(0, 0, 5, 5);
		var b = new BoundingBox(2, -3, 10, 4);
		var u = a.Union(b);
		Assert.Equal(0, u.MinX);
		Assert.Equal(-3, u.MinY);
		Assert.Equal(10, u.MaxX);
		Assert.Equal(5, u.MaxY);
	}

	[Fact]
	public void Inflate_expands_each_axis_independently()
	{
		var b = new BoundingBox(0, 0, 10, 10).Inflate(1, 2);
		Assert.Equal(-1, b.MinX);
		Assert.Equal(-2, b.MinY);
		Assert.Equal(11, b.MaxX);
		Assert.Equal(12, b.MaxY);
	}

	[Fact]
	public void Contains_checks_point_inclusion()
	{
		var b = new BoundingBox(0, 0, 10, 10);
		Assert.True(b.Contains(new Point2D(5, 5)));
		Assert.True(b.Contains(new Point2D(0, 0)));
		Assert.False(b.Contains(new Point2D(11, 5)));
	}
}
