using System;

namespace Selva.Drawing.Model.Geometry;

// Axis-aligned 2D bounding box in Y-up world coordinates. The Empty value is the additive
// identity for Union: empty.Union(x) == x. Width/Height are zero (not negative) for empty.
public readonly struct BoundingBox : IEquatable<BoundingBox>
{
	public static readonly BoundingBox Empty =
		new BoundingBox(double.PositiveInfinity, double.PositiveInfinity,
		                double.NegativeInfinity, double.NegativeInfinity);

	public double MinX { get; }
	public double MinY { get; }
	public double MaxX { get; }
	public double MaxY { get; }

	public BoundingBox(double minX, double minY, double maxX, double maxY)
	{
		MinX = minX; MinY = minY; MaxX = maxX; MaxY = maxY;
	}

	public static BoundingBox FromCorners(Point2D a, Point2D b) =>
		new BoundingBox(
			a.X < b.X ? a.X : b.X,
			a.Y < b.Y ? a.Y : b.Y,
			a.X > b.X ? a.X : b.X,
			a.Y > b.Y ? a.Y : b.Y);

	public static BoundingBox FromPoint(Point2D p) =>
		new BoundingBox(p.X, p.Y, p.X, p.Y);

	public bool IsValid => MinX <= MaxX && MinY <= MaxY;
	public bool IsEmpty => !IsValid;

	public double Width => IsValid ? MaxX - MinX : 0;
	public double Height => IsValid ? MaxY - MinY : 0;
	public Point2D Min => new Point2D(MinX, MinY);
	public Point2D Max => new Point2D(MaxX, MaxY);
	public Point2D Center => new Point2D((MinX + MaxX) / 2, (MinY + MaxY) / 2);

	public BoundingBox Union(BoundingBox other)
	{
		if (other.IsEmpty) return this;
		if (IsEmpty) return other;
		return new BoundingBox(
			Math.Min(MinX, other.MinX),
			Math.Min(MinY, other.MinY),
			Math.Max(MaxX, other.MaxX),
			Math.Max(MaxY, other.MaxY));
	}

	public BoundingBox Union(Point2D p)
	{
		if (IsEmpty) return FromPoint(p);
		return new BoundingBox(
			Math.Min(MinX, p.X),
			Math.Min(MinY, p.Y),
			Math.Max(MaxX, p.X),
			Math.Max(MaxY, p.Y));
	}

	public BoundingBox Inflate(double dx, double dy)
	{
		if (IsEmpty) return this;
		return new BoundingBox(MinX - dx, MinY - dy, MaxX + dx, MaxY + dy);
	}

	public bool Contains(Point2D p) =>
		IsValid && p.X >= MinX && p.X <= MaxX && p.Y >= MinY && p.Y <= MaxY;

	public bool Equals(BoundingBox other) =>
		MinX == other.MinX && MinY == other.MinY && MaxX == other.MaxX && MaxY == other.MaxY;

	public override bool Equals(object obj) => obj is BoundingBox b && Equals(b);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = MinX.GetHashCode();
			h = (h * 397) ^ MinY.GetHashCode();
			h = (h * 397) ^ MaxX.GetHashCode();
			h = (h * 397) ^ MaxY.GetHashCode();
			return h;
		}
	}

	public static bool operator ==(BoundingBox a, BoundingBox b) => a.Equals(b);
	public static bool operator !=(BoundingBox a, BoundingBox b) => !a.Equals(b);
}
