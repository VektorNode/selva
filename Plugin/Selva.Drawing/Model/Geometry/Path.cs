using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Drawing.Model.Geometry;

// Immutable typed path. Construct via Builder for ergonomic chaining, or pass an explicit
// list of segments. Empty paths are legal — they just produce no draw output and an empty
// bounding box.
public sealed class Path : IReadOnlyList<PathSegment>, IEquatable<Path>
{
	public static readonly Path Empty = new Path(Array.Empty<PathSegment>());

	private readonly PathSegment[] _segments;

	public Path(IEnumerable<PathSegment> segments)
	{
		if (segments == null) throw new ArgumentNullException(nameof(segments));
		_segments = segments.ToArray();
		foreach (var s in _segments)
			if (s == null) throw new ArgumentException("Path segments must be non-null.", nameof(segments));
	}

	public int Count => _segments.Length;
	public PathSegment this[int index] => _segments[index];
	public IEnumerator<PathSegment> GetEnumerator() => ((IReadOnlyList<PathSegment>)_segments).GetEnumerator();
	IEnumerator IEnumerable.GetEnumerator() => _segments.GetEnumerator();

	public bool IsEmpty => _segments.Length == 0;

	// Computes a tight axis-aligned bounding box. Cubic segments find derivative roots so
	// curves that bow outside their hull are still bounded correctly. Arc segments use a
	// safe outer bound (endpoints expanded by the radii); a tight arc bound costs more
	// trig and isn't needed for layout/viewBox purposes.
	public BoundingBox ComputeBounds()
	{
		var bounds = BoundingBox.Empty;
		var current = Point2D.Zero;
		var hasCurrent = false;
		var subpathStart = Point2D.Zero;

		foreach (var seg in _segments)
		{
			switch (seg)
			{
				case PathSegment.MoveTo m:
					bounds = bounds.Union(m.To);
					current = m.To;
					subpathStart = m.To;
					hasCurrent = true;
					break;

				case PathSegment.LineTo l:
					if (hasCurrent) bounds = bounds.Union(current);
					bounds = bounds.Union(l.To);
					current = l.To;
					hasCurrent = true;
					break;

				case PathSegment.CubicTo c:
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					bounds = bounds.Union(CubicBounds(current, c.Control1, c.Control2, c.To));
					current = c.To;
					break;

				case PathSegment.ArcTo a:
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					bounds = bounds.Union(ArcBoundsConservative(current, a));
					current = a.To;
					break;

				case PathSegment.Close _:
					if (hasCurrent) bounds = bounds.Union(subpathStart);
					current = subpathStart;
					break;
			}
		}

		return bounds;
	}

	private static BoundingBox CubicBounds(Point2D p0, Point2D p1, Point2D p2, Point2D p3)
	{
		var b = BoundingBox.FromPoint(p0).Union(p3);
		AccumulateCubicAxis(ref b, p0.X, p1.X, p2.X, p3.X, isX: true);
		AccumulateCubicAxis(ref b, p0.Y, p1.Y, p2.Y, p3.Y, isX: false);
		return b;
	}

	// Solve B'(t) = 0 for the cubic on one axis: gives at most two t values in (0,1)
	// where the curve hits a local extremum. The endpoints are already in the bbox.
	private static void AccumulateCubicAxis(ref BoundingBox b, double v0, double v1, double v2, double v3, bool isX)
	{
		var a = -v0 + 3 * v1 - 3 * v2 + v3;
		var bb = 2 * v0 - 4 * v1 + 2 * v2;
		var cc = -v0 + v1;

		if (Math.Abs(a) < 1e-12)
		{
			if (Math.Abs(bb) < 1e-12) return;
			AddIfInRange(ref b, -cc / bb, v0, v1, v2, v3, isX);
			return;
		}

		var disc = bb * bb - 4 * a * cc;
		if (disc < 0) return;
		var sqrtDisc = Math.Sqrt(disc);
		AddIfInRange(ref b, (-bb + sqrtDisc) / (2 * a), v0, v1, v2, v3, isX);
		AddIfInRange(ref b, (-bb - sqrtDisc) / (2 * a), v0, v1, v2, v3, isX);
	}

	private static void AddIfInRange(ref BoundingBox b, double t, double v0, double v1, double v2, double v3, bool isX)
	{
		if (t <= 0 || t >= 1) return;
		var u = 1 - t;
		var v = u * u * u * v0 + 3 * u * u * t * v1 + 3 * u * t * t * v2 + t * t * t * v3;
		b = isX
			? new BoundingBox(Math.Min(b.MinX, v), b.MinY, Math.Max(b.MaxX, v), b.MaxY)
			: new BoundingBox(b.MinX, Math.Min(b.MinY, v), b.MaxX, Math.Max(b.MaxY, v));
	}

	private static BoundingBox ArcBoundsConservative(Point2D from, PathSegment.ArcTo a)
	{
		// Conservative bound: endpoints plus a box centred on each endpoint expanded by the
		// radii. Always contains the true ellipse arc, possibly with slack — fine for
		// viewBox padding and layout decisions which already pad themselves.
		var rx = Math.Abs(a.RadiusX);
		var ry = Math.Abs(a.RadiusY);
		var b = BoundingBox.FromPoint(from).Union(a.To);
		b = b.Inflate(rx, ry);
		return b;
	}

	public bool Equals(Path other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		if (_segments.Length != other._segments.Length) return false;
		for (var i = 0; i < _segments.Length; i++)
			if (!_segments[i].Equals(other._segments[i])) return false;
		return true;
	}

	public override bool Equals(object obj) => Equals(obj as Path);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = 17;
			foreach (var s in _segments) h = (h * 397) ^ s.GetHashCode();
			return h;
		}
	}

	public sealed class Builder
	{
		private readonly List<PathSegment> _segments = new List<PathSegment>();

		public Builder MoveTo(double x, double y) { _segments.Add(new PathSegment.MoveTo(new Point2D(x, y))); return this; }
		public Builder MoveTo(Point2D p) { _segments.Add(new PathSegment.MoveTo(p)); return this; }
		public Builder LineTo(double x, double y) { _segments.Add(new PathSegment.LineTo(new Point2D(x, y))); return this; }
		public Builder LineTo(Point2D p) { _segments.Add(new PathSegment.LineTo(p)); return this; }
		public Builder CubicTo(Point2D c1, Point2D c2, Point2D to) { _segments.Add(new PathSegment.CubicTo(c1, c2, to)); return this; }
		public Builder QuadraticTo(Point2D start, Point2D control, Point2D end) { _segments.Add(PathSegment.CubicTo.FromQuadratic(start, control, end)); return this; }
		public Builder ArcTo(Point2D to, double rx, double ry, double xAxisRotationDeg, bool largeArc, bool sweepClockwise)
		{ _segments.Add(new PathSegment.ArcTo(to, rx, ry, xAxisRotationDeg, largeArc, sweepClockwise)); return this; }
		public Builder Close() { _segments.Add(PathSegment.Close.Instance); return this; }

		public Path Build() => new Path(_segments);
	}
}
