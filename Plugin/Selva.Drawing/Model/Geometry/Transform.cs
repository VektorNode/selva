using System;

namespace Selva.Drawing.Model.Geometry;

// 2D affine transform represented as the 3x3 matrix
// [ A  C  E ]   [ x ]
// [ B  D  F ] * [ y ]
// [ 0  0  1 ]   [ 1 ]
// matching SVG's matrix(A B C D E F) convention so SvgRenderer can emit it directly.
public readonly struct Transform : IEquatable<Transform>
{
	public double A { get; }
	public double B { get; }
	public double C { get; }
	public double D { get; }
	public double E { get; }
	public double F { get; }

	public Transform(double a, double b, double c, double d, double e, double f)
	{
		A = a; B = b; C = c; D = d; E = e; F = f;
	}

	public static Transform Identity => new Transform(1, 0, 0, 1, 0, 0);
	public bool IsIdentity => A == 1 && B == 0 && C == 0 && D == 1 && E == 0 && F == 0;

	public static Transform Translate(double tx, double ty) => new Transform(1, 0, 0, 1, tx, ty);
	public static Transform Scale(double sx, double sy) => new Transform(sx, 0, 0, sy, 0, 0);
	public static Transform Scale(double s) => Scale(s, s);

	public static Transform Rotate(double radians)
	{
		var c = Math.Cos(radians);
		var s = Math.Sin(radians);
		return new Transform(c, s, -s, c, 0, 0);
	}

	public static Transform RotateDegrees(double degrees) => Rotate(degrees * Math.PI / 180.0);

	// Returns this followed by `other` (right-to-left function composition: result(p) = other(this(p))).
	public Transform Then(Transform other) => other.Multiply(this);

	// Standard matrix multiplication: this * rhs.
	public Transform Multiply(Transform rhs) =>
		new Transform(
			A * rhs.A + C * rhs.B,
			B * rhs.A + D * rhs.B,
			A * rhs.C + C * rhs.D,
			B * rhs.C + D * rhs.D,
			A * rhs.E + C * rhs.F + E,
			B * rhs.E + D * rhs.F + F);

	public Point2D Apply(Point2D p) =>
		new Point2D(A * p.X + C * p.Y + E, B * p.X + D * p.Y + F);

	public bool Equals(Transform other) =>
		A == other.A && B == other.B && C == other.C && D == other.D && E == other.E && F == other.F;

	public override bool Equals(object obj) => obj is Transform t && Equals(t);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = A.GetHashCode();
			h = (h * 397) ^ B.GetHashCode();
			h = (h * 397) ^ C.GetHashCode();
			h = (h * 397) ^ D.GetHashCode();
			h = (h * 397) ^ E.GetHashCode();
			h = (h * 397) ^ F.GetHashCode();
			return h;
		}
	}

	public static bool operator ==(Transform a, Transform b) => a.Equals(b);
	public static bool operator !=(Transform a, Transform b) => !a.Equals(b);
}
