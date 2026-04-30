using System;

namespace Selva.Drawing.Model.Geometry;

public readonly struct Point2D : IEquatable<Point2D>
{
	public double X { get; }
	public double Y { get; }

	public Point2D(double x, double y) { X = x; Y = y; }

	public static Point2D Zero => new Point2D(0, 0);

	public bool Equals(Point2D other) => X == other.X && Y == other.Y;
	public override bool Equals(object obj) => obj is Point2D p && Equals(p);
	public override int GetHashCode() { unchecked { return (X.GetHashCode() * 397) ^ Y.GetHashCode(); } }
	public static bool operator ==(Point2D a, Point2D b) => a.Equals(b);
	public static bool operator !=(Point2D a, Point2D b) => !a.Equals(b);
}
