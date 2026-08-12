using System;
using Selva.Drawing.Model.Geometry;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model;

public class PathTests
{
	[Fact]
	public void Builder_chains_segments()
	{
		var p = new Path.Builder()
			.MoveTo(0, 0)
			.LineTo(10, 0)
			.LineTo(10, 10)
			.Close()
			.Build();

		Assert.Equal(4, p.Count);
		Assert.IsType<PathSegment.MoveTo>(p[0]);
		Assert.IsType<PathSegment.LineTo>(p[1]);
		Assert.IsType<PathSegment.LineTo>(p[2]);
		Assert.IsType<PathSegment.Close>(p[3]);
	}

	[Fact]
	public void Empty_path_has_empty_bounds()
	{
		Assert.True(Path.Empty.ComputeBounds().IsEmpty);
	}

	[Fact]
	public void Bounds_for_polyline_match_endpoints()
	{
		var p = new Path.Builder()
			.MoveTo(2, 3)
			.LineTo(7, -1)
			.LineTo(0, 5)
			.Build();

		var b = p.ComputeBounds();
		Assert.Equal(0, b.MinX);
		Assert.Equal(-1, b.MinY);
		Assert.Equal(7, b.MaxX);
		Assert.Equal(5, b.MaxY);
	}

	[Fact]
	public void Cubic_bounds_capture_control_polygon_overshoot()
	{
		// Endpoints are (0,0) and (10,0), but the control points pull the curve up to y=7.5.
		// Bounds must capture that extremum, not just the endpoints.
		var p = new Path.Builder()
			.MoveTo(0, 0)
			.CubicTo(new Point2D(0, 10), new Point2D(10, 10), new Point2D(10, 0))
			.Build();

		var b = p.ComputeBounds();
		Assert.Equal(0, b.MinX);
		Assert.Equal(0, b.MinY);
		Assert.Equal(10, b.MaxX);
		// Cubic with control points at y=10 peaks at y=7.5 (3/4 of control height).
		Assert.Equal(7.5, Math.Round(b.MaxY, 6));
	}

	[Fact]
	public void Quadratic_to_cubic_elevation_preserves_endpoints()
	{
		var start = new Point2D(0, 0);
		var control = new Point2D(5, 10);
		var end = new Point2D(10, 0);

		var c = PathSegment.CubicTo.FromQuadratic(start, control, end);
		Assert.Equal(end, c.To);
		// Elevated control points sit 2/3 of the way from each endpoint to the quadratic control point.
		Assert.Equal(new Point2D(start.X + 2.0 / 3 * (control.X - start.X), start.Y + 2.0 / 3 * (control.Y - start.Y)), c.Control1);
		Assert.Equal(new Point2D(end.X + 2.0 / 3 * (control.X - end.X), end.Y + 2.0 / 3 * (control.Y - end.Y)), c.Control2);
	}

	[Fact]
	public void Path_equality_by_segments()
	{
		var a = new Path.Builder().MoveTo(0, 0).LineTo(10, 10).Build();
		var b = new Path.Builder().MoveTo(0, 0).LineTo(10, 10).Build();
		var c = new Path.Builder().MoveTo(0, 0).LineTo(20, 20).Build();
		Assert.True(a.Equals(b));
		Assert.Equal(a.GetHashCode(), b.GetHashCode());
		Assert.False(a.Equals(c));
	}

	[Fact]
	public void Close_returns_to_subpath_start_in_bounds()
	{
		var p = new Path.Builder()
			.MoveTo(5, 5)
			.LineTo(10, 5)
			.LineTo(10, 10)
			.Close()
			.Build();

		var b = p.ComputeBounds();
		Assert.Equal(5, b.MinX);
		Assert.Equal(5, b.MinY);
		Assert.Equal(10, b.MaxX);
		Assert.Equal(10, b.MaxY);
	}
}
