using System;

namespace Selva.Drawing.Model.Geometry;

// Path commands, modelled as a closed hierarchy. Renderers switch on the runtime type;
// any new segment kind must be a new sealed record below. Keeping this list small is
// deliberate: it matches what SVG paths and PDF content streams natively express.
public abstract record PathSegment
{
	private PathSegment() { }

	public sealed record MoveTo(Point2D To) : PathSegment;

	public sealed record LineTo(Point2D To) : PathSegment;

	// Cubic Bezier with two control points. Quadratic curves are expressed as cubics on
	// construction rather than carrying a separate segment kind: keeps the visitor surface
	// small. FromQuadratic does the standard P1/P2 elevation.
	public sealed record CubicTo(Point2D Control1, Point2D Control2, Point2D To) : PathSegment
	{
		public static CubicTo FromQuadratic(Point2D start, Point2D control, Point2D end)
		{
			// C1 = start + 2/3 * (control - start), C2 = end + 2/3 * (control - end)
			var c1 = new Point2D(start.X + 2.0 / 3.0 * (control.X - start.X),
				start.Y + 2.0 / 3.0 * (control.Y - start.Y));
			var c2 = new Point2D(end.X + 2.0 / 3.0 * (control.X - end.X),
				end.Y + 2.0 / 3.0 * (control.Y - end.Y));
			return new CubicTo(c1, c2, end);
		}
	}

	// Elliptical arc command, mirroring SVG's A/a primitive: the same parameters round-trip
	// cleanly to both SVG and PDF (PDF flattens to cubics; SVG emits the arc directly).
	public sealed record ArcTo(
		Point2D To,
		double RadiusX,
		double RadiusY,
		double XAxisRotationDegrees,
		bool LargeArc,
		bool SweepClockwise) : PathSegment;

	public sealed record Close : PathSegment
	{
		public static readonly Close Instance = new Close();
	}
}
