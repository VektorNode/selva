using System;
using System.Collections.Generic;
using Rhino.Geometry;
using Selva.Drawing.Model.Geometry;
using PathSeg = Selva.Drawing.Model.Geometry.PathSegment;
using ModelPath = Selva.Drawing.Model.Geometry.Path;
using ModelPoint = Selva.Drawing.Model.Geometry.Point2D;

namespace Selva.Drawing.RhinoInterop;

// Inverse of CurveConverter: takes a model Path and rebuilds Rhino curves, one per
// closed subpath. Used by RhinoViewportVisitor so closed paths can be filled via
// Brep.CreatePlanarBreps + DrawBrepShaded — orders of magnitude faster than the
// hand-rolled tessellate-and-ear-clip path, and Rhino handles concavity + holes.
internal static class PathToCurves
{
    public static List<Curve> ClosedSubpaths(ModelPath path)
    {
        var result = new List<Curve>();
        if (path == null || path.IsEmpty) return result;

        var segs = new List<Curve>();
        var cursor = new ModelPoint(0, 0);
        var subpathStart = cursor;
        var hasCursor = false;

        void Flush(bool closed)
        {
            if (!closed || segs.Count == 0) { segs.Clear(); return; }
            var joined = Curve.JoinCurves(segs, 0.001);
            segs.Clear();
            if (joined == null) return;
            foreach (var c in joined)
                if (c != null && c.IsClosed) result.Add(c);
        }

        foreach (var seg in path)
        {
            switch (seg)
            {
                case PathSeg.MoveTo m:
                    Flush(closed: false);
                    cursor = m.To;
                    subpathStart = m.To;
                    hasCursor = true;
                    break;

                case PathSeg.LineTo l when hasCursor:
                    if (!Same(cursor, l.To))
                        segs.Add(new LineCurve(ToPoint(cursor), ToPoint(l.To)));
                    cursor = l.To;
                    break;

                case PathSeg.CubicTo c when hasCursor:
                    segs.Add(CubicNurbs(cursor, c.Control1, c.Control2, c.To));
                    cursor = c.To;
                    break;

                case PathSeg.ArcTo a when hasCursor:
                    var arcCrv = ArcCurveFromSvg(cursor, a);
                    if (arcCrv != null) segs.Add(arcCrv);
                    cursor = a.To;
                    break;

                case PathSeg.Close _ when hasCursor:
                    if (!Same(cursor, subpathStart))
                        segs.Add(new LineCurve(ToPoint(cursor), ToPoint(subpathStart)));
                    cursor = subpathStart;
                    Flush(closed: true);
                    break;
            }
        }
        Flush(closed: false);
        return result;
    }

    private static bool Same(ModelPoint a, ModelPoint b) =>
        Math.Abs(a.X - b.X) < 1e-9 && Math.Abs(a.Y - b.Y) < 1e-9;

    private static Point3d ToPoint(ModelPoint p) => new Point3d(p.X, p.Y, 0);

    private static NurbsCurve CubicNurbs(ModelPoint p0, ModelPoint p1, ModelPoint p2, ModelPoint p3)
    {
        var bezier = new BezierCurve(new[] { ToPoint(p0), ToPoint(p1), ToPoint(p2), ToPoint(p3) });
        return bezier.ToNurbsCurve();
    }

    // Reconstruct an ArcCurve from SVG endpoint-parameterization. Falls back to null when
    // the arc collapses to a line (radii too small) — caller skips it.
    private static Curve ArcCurveFromSvg(ModelPoint from, PathSeg.ArcTo a)
    {
        var rx = Math.Abs(a.RadiusX);
        var ry = Math.Abs(a.RadiusY);
        if (rx < 1e-9 || ry < 1e-9) return new LineCurve(ToPoint(from), ToPoint(a.To));

        // Circular arc: use Rhino's Arc directly. Elliptical (rx != ry or rotated): build a
        // NURBS approximation by sampling — preview-quality, no ear-clipping perf hit.
        var phi = a.XAxisRotationDegrees * Math.PI / 180.0;
        if (Math.Abs(rx - ry) < 1e-9 && Math.Abs(phi) < 1e-9)
        {
            var arc = ComputeCircularArc(from, a, rx);
            if (arc.HasValue) return new ArcCurve(arc.Value);
        }

        return EllipticalNurbs(from, a);
    }

    private static Arc? ComputeCircularArc(ModelPoint from, PathSeg.ArcTo a, double r)
    {
        // Center via SVG endpoint-parameterization (W3C SVG 1.1 Appendix F.6.5), simplified
        // for circular arcs (rx == ry, phi == 0). Then build a 3-point arc from
        // (start, midpoint, end) — Rhino's Arc constructor handles the rest.
        var dx = (from.X - a.To.X) * 0.5;
        var dy = (from.Y - a.To.Y) * 0.5;
        var d2 = dx * dx + dy * dy;
        if (d2 < 1e-18) return null;
        if (d2 > r * r) r = Math.Sqrt(d2); // grow to feasibility (matches SVG spec)
        var factor = Math.Sqrt(Math.Max(0, r * r - d2) / d2);
        if (a.LargeArc == a.SweepClockwise) factor = -factor;
        var cx = (from.X + a.To.X) * 0.5 + factor * dy;
        var cy = (from.Y + a.To.Y) * 0.5 - factor * dx;

        // Arc midpoint: from center, in the direction of the chord midpoint, at radius r.
        // For a large arc, flip to the far side.
        var mx = (from.X + a.To.X) * 0.5 - cx;
        var my = (from.Y + a.To.Y) * 0.5 - cy;
        var mlen = Math.Sqrt(mx * mx + my * my);
        if (mlen < 1e-12) return null;
        var s = a.LargeArc ? -1.0 : 1.0;
        var midX = cx + mx / mlen * r * s;
        var midY = cy + my / mlen * r * s;

        var arc = new Arc(
            new Point3d(from.X, from.Y, 0),
            new Point3d(midX, midY, 0),
            new Point3d(a.To.X, a.To.Y, 0));
        return arc.IsValid ? arc : (Arc?)null;
    }

    private static NurbsCurve EllipticalNurbs(ModelPoint from, PathSeg.ArcTo a)
    {
        // Sample the SVG arc at fixed angular steps and fit a degree-3 NURBS through the
        // points. Preview-quality only — accurate enough that planar-brep tolerance is happy.
        var pts = new List<Point3d>(33);
        pts.Add(new Point3d(from.X, from.Y, 0));
        foreach (var p in SampleArc(from, a, 32))
            pts.Add(new Point3d(p.X, p.Y, 0));
        var crv = Curve.CreateInterpolatedCurve(pts, 3);
        return crv?.ToNurbsCurve();
    }

    private static IEnumerable<ModelPoint> SampleArc(ModelPoint from, PathSeg.ArcTo a, int steps)
    {
        var rx = Math.Abs(a.RadiusX);
        var ry = Math.Abs(a.RadiusY);
        var phi = a.XAxisRotationDegrees * Math.PI / 180.0;
        var cosPhi = Math.Cos(phi);
        var sinPhi = Math.Sin(phi);

        var dx = (from.X - a.To.X) * 0.5;
        var dy = (from.Y - a.To.Y) * 0.5;
        var x1p = cosPhi * dx + sinPhi * dy;
        var y1p = -sinPhi * dx + cosPhi * dy;

        var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1.0)
        {
            var s = Math.Sqrt(lambda);
            rx *= s;
            ry *= s;
        }

        var rx2 = rx * rx;
        var ry2 = ry * ry;
        var x1p2 = x1p * x1p;
        var y1p2 = y1p * y1p;
        var num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
        var den = rx2 * y1p2 + ry2 * x1p2;
        var factor = den < 1e-12 ? 0.0 : Math.Sqrt(Math.Max(0.0, num / den));
        if (a.LargeArc == a.SweepClockwise) factor = -factor;
        var cxp = factor * (rx * y1p / ry);
        var cyp = factor * (-ry * x1p / rx);

        var cx = cosPhi * cxp - sinPhi * cyp + (from.X + a.To.X) * 0.5;
        var cy = sinPhi * cxp + cosPhi * cyp + (from.Y + a.To.Y) * 0.5;

        var ux = (x1p - cxp) / rx;
        var uy = (y1p - cyp) / ry;
        var vx = (-x1p - cxp) / rx;
        var vy = (-y1p - cyp) / ry;
        var theta1 = AngleBetween(1, 0, ux, uy);
        var deltaTheta = AngleBetween(ux, uy, vx, vy);
        if (!a.SweepClockwise && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
        else if (a.SweepClockwise && deltaTheta < 0) deltaTheta += 2 * Math.PI;

        for (var i = 1; i <= steps; i++)
        {
            var t = i / (double)steps;
            var ang = theta1 + deltaTheta * t;
            var ex = Math.Cos(ang) * rx;
            var ey = Math.Sin(ang) * ry;
            var px = cosPhi * ex - sinPhi * ey + cx;
            var py = sinPhi * ex + cosPhi * ey + cy;
            yield return new ModelPoint(px, py);
        }
    }

    private static double AngleBetween(double ux, double uy, double vx, double vy)
    {
        var dot = ux * vx + uy * vy;
        var len = Math.Sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        if (len < 1e-12) return 0;
        var c = dot / len;
        if (c < -1) c = -1;
        else if (c > 1) c = 1;
        var sign = (ux * vy - uy * vx) < 0 ? -1.0 : 1.0;
        return sign * Math.Acos(c);
    }
}
