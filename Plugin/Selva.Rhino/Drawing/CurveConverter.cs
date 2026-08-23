using System;
using Rhino.Geometry;
using Selva.Drawing.Model.Geometry;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.RhinoInterop;

// Converts Rhino curves to model Paths, so the same curve can drive both SVG and PDF renderers.
public static class CurveConverter
{
    public static Path ToPath(Curve curve, double chordTol = 0.01, double kinkTol = 0.01)
    {
        if (curve == null) throw new ArgumentNullException(nameof(curve));

        switch (curve)
        {
            case LineCurve line:
                return LineToPath(line);
            case PolylineCurve polyline:
                return PolylineToPath(polyline);
            case ArcCurve arc:
                return ArcToPath(arc);
            default:
                return BezierApproxToPath(curve, chordTol, kinkTol);
        }
    }

    private static Path LineToPath(LineCurve line)
    {
        var a = line.PointAtStart;
        var b = line.PointAtEnd;
        return new Path.Builder()
            .MoveTo(a.X, a.Y)
            .LineTo(b.X, b.Y)
            .Build();
    }

    private static Path PolylineToPath(PolylineCurve poly)
    {
        if (poly.PointCount == 0) return Path.Empty;

        var builder = new Path.Builder();
        var p0 = poly.Point(0);
        builder.MoveTo(p0.X, p0.Y);
        for (var i = 1; i < poly.PointCount; i++)
        {
            var p = poly.Point(i);
            builder.LineTo(p.X, p.Y);
        }
        if (poly.IsClosed) builder.Close();
        return builder.Build();
    }

    private static Path ArcToPath(ArcCurve arcCurve)
    {
        var arc = arcCurve.Arc;

        // Arc.AngleDomain.Length is always positive in RhinoCommon, so direction comes from
        // the plane normal instead: +Z sweeps CCW in world XY, −Z sweeps CW (trims, fillets,
        // and reversed curves commonly go this way). Without this every arc bowed CCW
        // regardless of its real direction. World-CCW maps to SVG sweep=1 after the root Y-flip.
        var sweepClockwise = arc.Plane.Normal.Z >= 0;

        // Full circle: a single SVG A-segment can't cover 360°, so emit two half-arcs.
        // Carrying the curve's authored sweep through both keeps NonZero-fill winding correct
        // (hole circles are usually wound opposite the outer one).
        if (Math.Abs(arc.AngleDomain.Length - 2 * Math.PI) < 1e-10)
        {
            var c = arc.Center;
            var r = arc.Radius;
            return new Path.Builder()
                .MoveTo(c.X + r, c.Y)
                .ArcTo(new Point2D(c.X - r, c.Y), r, r, 0, largeArc: true, sweepClockwise: sweepClockwise)
                .ArcTo(new Point2D(c.X + r, c.Y), r, r, 0, largeArc: true, sweepClockwise: sweepClockwise)
                .Close()
                .Build();
        }

        var start = arc.PointAt(arc.AngleDomain.T0);
        var end = arc.PointAt(arc.AngleDomain.T1);
        var largeArc = arc.AngleDomain.Length > Math.PI;

        return new Path.Builder()
            .MoveTo(start.X, start.Y)
            .ArcTo(new Point2D(end.X, end.Y), arc.Radius, arc.Radius, 0, largeArc, sweepClockwise)
            .Build();
    }

    private static Path BezierApproxToPath(Curve curve, double chordTol, double kinkTol)
    {
        var beziers = BezierCurve.CreateCubicBeziers(curve, chordTol, kinkTol);
        if (beziers == null || beziers.Length == 0) return Path.Empty;

        var builder = new Path.Builder();
        var moved = false;
        Point3d last = default;

        foreach (var seg in beziers)
        {
            var cps = seg.ToNurbsCurve().Points;
            var p0 = cps[0].Location;
            var p1 = cps[1].Location;
            var p2 = cps[2].Location;
            var p3 = cps[3].Location;

            if (!moved)
            {
                builder.MoveTo(p0.X, p0.Y);
                moved = true;
            }
            else
            {
                var dx = last.X - p0.X;
                var dy = last.Y - p0.Y;
                if (dx * dx + dy * dy > 1e-12) builder.LineTo(p0.X, p0.Y);
            }

            builder.CubicTo(new Point2D(p1.X, p1.Y), new Point2D(p2.X, p2.Y), new Point2D(p3.X, p3.Y));
            last = p3;
        }

        if (curve.IsClosed) builder.Close();
        return builder.Build();
    }
}
