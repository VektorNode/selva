using System;
using System.Collections.Generic;
using PdfSharpCore.Drawing;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Rendering.Pdf;

// Converts a typed model Path into a PdfSharpCore XGraphicsPath. Mirrors what
// SvgPathBuilder does for SVG, but expressed in PdfSharpCore primitives: each LineTo
// becomes an AddLine(prev, to), each CubicTo becomes AddBezier(prev, c1, c2, to),
// and ArcTo is flattened to one or more cubics via the W3C SVG arc-to-cubic algorithm
// because XGraphicsPath.AddArc takes a different (centre/start/sweep) parameterisation
// than our SVG-style ArcTo (radii/large-arc/sweep flags).
//
// Subpaths: a MoveTo after the first segment becomes StartFigure() so PdfSharpCore
// treats it as a new disjoint sub-path (matters for fill rules with holes).
public static class PdfPathBuilder
{
	public static XGraphicsPath Build(Path path)
	{
		var xpath = new XGraphicsPath();
		if (path == null || path.IsEmpty) return xpath;

		Point2D current = Point2D.Zero;
		Point2D subpathStart = Point2D.Zero;
		var hasCurrent = false;
		var firstMoveSeen = false;

		foreach (var seg in path)
		{
			switch (seg)
			{
				case PathSegment.MoveTo m:
					if (firstMoveSeen) xpath.StartFigure();
					current = m.To;
					subpathStart = m.To;
					hasCurrent = true;
					firstMoveSeen = true;
					break;

				case PathSegment.LineTo l:
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					xpath.AddLine(current.X, current.Y, l.To.X, l.To.Y);
					current = l.To;
					break;

				case PathSegment.CubicTo c:
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					xpath.AddBezier(
						current.X, current.Y,
						c.Control1.X, c.Control1.Y,
						c.Control2.X, c.Control2.Y,
						c.To.X, c.To.Y);
					current = c.To;
					break;

				case PathSegment.ArcTo a:
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					EmitSvgArcAsCubics(xpath, current, a);
					current = a.To;
					break;

				case PathSegment.Close _:
					xpath.CloseFigure();
					if (hasCurrent) current = subpathStart;
					break;
			}
		}

		return xpath;
	}

	// Splits a Path into one XGraphicsPath per subpath (i.e. per MoveTo). Stroking via a
	// single XGraphicsPath with multiple StartFigure() boundaries lets PdfSharpCore /
	// underlying GDI silently merge disjoint figures into one connected polyline, which
	// shows up as diagonal lines crossing through cells when rendering tables with grid
	// dividers. Drawing each subpath as its own XGraphicsPath sidesteps that entirely.
	// Used by stroke-only paths; fills still need a single path for correct hole semantics.
	public static IReadOnlyList<XGraphicsPath> BuildSubpaths(Path path)
	{
		var result = new List<XGraphicsPath>();
		if (path == null || path.IsEmpty) return result;

		XGraphicsPath xpath = null;
		Point2D current = Point2D.Zero;
		Point2D subpathStart = Point2D.Zero;
		var hasCurrent = false;

		foreach (var seg in path)
		{
			switch (seg)
			{
				case PathSegment.MoveTo m:
					xpath = new XGraphicsPath();
					result.Add(xpath);
					current = m.To;
					subpathStart = m.To;
					hasCurrent = true;
					break;

				case PathSegment.LineTo l:
					if (xpath == null) { xpath = new XGraphicsPath(); result.Add(xpath); }
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					xpath.AddLine(current.X, current.Y, l.To.X, l.To.Y);
					current = l.To;
					break;

				case PathSegment.CubicTo c:
					if (xpath == null) { xpath = new XGraphicsPath(); result.Add(xpath); }
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					xpath.AddBezier(
						current.X, current.Y,
						c.Control1.X, c.Control1.Y,
						c.Control2.X, c.Control2.Y,
						c.To.X, c.To.Y);
					current = c.To;
					break;

				case PathSegment.ArcTo a:
					if (xpath == null) { xpath = new XGraphicsPath(); result.Add(xpath); }
					if (!hasCurrent) { current = Point2D.Zero; hasCurrent = true; }
					EmitSvgArcAsCubics(xpath, current, a);
					current = a.To;
					break;

				case PathSegment.Close _:
					if (xpath != null) xpath.CloseFigure();
					if (hasCurrent) current = subpathStart;
					break;
			}
		}

		return result;
	}

	// W3C SVG 1.1 implementation notes, F.6.5: convert an SVG-style elliptical arc to
	// centre-parameterised form, then split into <=π/2 sweeps and approximate each piece
	// with a cubic Bezier. ~12 lines of trig per piece — battle-tested algorithm.
	private static void EmitSvgArcAsCubics(XGraphicsPath xpath, Point2D from, PathSegment.ArcTo arc)
	{
		var x1 = from.X; var y1 = from.Y;
		var x2 = arc.To.X; var y2 = arc.To.Y;
		var rx = Math.Abs(arc.RadiusX);
		var ry = Math.Abs(arc.RadiusY);

		// Degenerate: zero radius or coincident endpoints — fall back to a straight line.
		if (rx < 1e-12 || ry < 1e-12 || (Math.Abs(x1 - x2) < 1e-12 && Math.Abs(y1 - y2) < 1e-12))
		{
			xpath.AddLine(x1, y1, x2, y2);
			return;
		}

		var phi = arc.XAxisRotationDegrees * Math.PI / 180.0;
		var cosPhi = Math.Cos(phi);
		var sinPhi = Math.Sin(phi);

		// Step 1: compute (x1', y1') — the coordinate of the midpoint of the line between
		// endpoints rotated to align the ellipse axes with the coordinate axes.
		var dx = (x1 - x2) / 2.0;
		var dy = (y1 - y2) / 2.0;
		var x1p = cosPhi * dx + sinPhi * dy;
		var y1p = -sinPhi * dx + cosPhi * dy;

		// Step 2: scale up radii if they're too small to span the chord. F.6.6.2 in the spec.
		var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
		if (lambda > 1)
		{
			var s = Math.Sqrt(lambda);
			rx *= s; ry *= s;
		}

		// Step 3: compute (cx', cy').
		var rxSq = rx * rx;
		var rySq = ry * ry;
		var x1pSq = x1p * x1p;
		var y1pSq = y1p * y1p;

		var num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
		if (num < 0) num = 0;
		var denom = rxSq * y1pSq + rySq * x1pSq;
		var coef = denom < 1e-30 ? 0 : Math.Sqrt(num / denom);

		// SVG flag convention: ArcTo.SweepClockwise here means the SVG sweep-flag is 1
		// (sweep angle increases). LargeArc and Sweep determine the centre selection sign.
		// We track the same flags the SVG renderer emits.
		if (arc.LargeArc == arc.SweepClockwise) coef = -coef;

		var cxp = coef * (rx * y1p / ry);
		var cyp = coef * -(ry * x1p / rx);

		// Step 4: rotate back and translate to absolute centre.
		var cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2.0;
		var cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2.0;

		// Step 5: compute start angle and sweep delta in the rotated/scaled space.
		var startVx = (x1p - cxp) / rx;
		var startVy = (y1p - cyp) / ry;
		var endVx = (-x1p - cxp) / rx;
		var endVy = (-y1p - cyp) / ry;

		var theta1 = AngleBetween(1, 0, startVx, startVy);
		var deltaTheta = AngleBetween(startVx, startVy, endVx, endVy);

		if (!arc.SweepClockwise && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
		else if (arc.SweepClockwise && deltaTheta < 0) deltaTheta += 2 * Math.PI;

		// Step 6: split into pieces of <= π/2 and approximate each with a cubic Bezier
		// using the alpha = (4/3) tan(Δθ/4) tangent-length formula.
		var segments = (int)Math.Ceiling(Math.Abs(deltaTheta) / (Math.PI / 2.0));
		if (segments < 1) segments = 1;
		var delta = deltaTheta / segments;
		var t = (4.0 / 3.0) * Math.Tan(delta / 4.0);

		var theta = theta1;
		var px = x1;
		var py = y1;
		for (var i = 0; i < segments; i++)
		{
			var theta2 = theta + delta;

			var cosTheta1 = Math.Cos(theta);
			var sinTheta1 = Math.Sin(theta);
			var cosTheta2 = Math.Cos(theta2);
			var sinTheta2 = Math.Sin(theta2);

			// Endpoint of this cubic in the rotated/scaled space → un-scale → un-rotate.
			var ex = cosTheta2;
			var ey = sinTheta2;
			var endLocalX = rx * ex;
			var endLocalY = ry * ey;
			var endX = cosPhi * endLocalX - sinPhi * endLocalY + cx;
			var endY = sinPhi * endLocalX + cosPhi * endLocalY + cy;

			// Tangents at start and end give the cubic control points.
			var c1LocalX = rx * (cosTheta1 - t * sinTheta1);
			var c1LocalY = ry * (sinTheta1 + t * cosTheta1);
			var c2LocalX = rx * (cosTheta2 + t * sinTheta2);
			var c2LocalY = ry * (sinTheta2 - t * cosTheta2);

			var c1X = cosPhi * c1LocalX - sinPhi * c1LocalY + cx;
			var c1Y = sinPhi * c1LocalX + cosPhi * c1LocalY + cy;
			var c2X = cosPhi * c2LocalX - sinPhi * c2LocalY + cx;
			var c2Y = sinPhi * c2LocalX + cosPhi * c2LocalY + cy;

			xpath.AddBezier(px, py, c1X, c1Y, c2X, c2Y, endX, endY);

			theta = theta2;
			px = endX;
			py = endY;
		}
	}

	private static double AngleBetween(double ux, double uy, double vx, double vy)
	{
		var dot = ux * vx + uy * vy;
		var len = Math.Sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
		if (len < 1e-30) return 0;
		var cos = dot / len;
		if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
		var angle = Math.Acos(cos);
		var cross = ux * vy - uy * vx;
		return cross < 0 ? -angle : angle;
	}
}
