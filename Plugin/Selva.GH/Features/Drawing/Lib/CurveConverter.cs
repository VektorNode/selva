using System;
using System.Globalization;
using System.Text;
using Rhino.Geometry;

namespace Selva.GH.Features.Drawing.Lib;

public static class CurveConverter
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static string ToSvgPathData(Curve curve, double chordTol = 0.01, double kinkTol = 0.01)
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

    private static string LineToPath(LineCurve line)
    {
        var a = line.PointAtStart;
        var b = line.PointAtEnd;
        var sb = new StringBuilder();
        sb.Append("M ").Append(F(a.X)).Append(' ').Append(F(a.Y));
        sb.Append(" L ").Append(F(b.X)).Append(' ').Append(F(b.Y));
        return sb.ToString();
    }

    private static string PolylineToPath(PolylineCurve poly)
    {
        if (poly.PointCount == 0) return string.Empty;
        var sb = new StringBuilder();
        var p0 = poly.Point(0);
        sb.Append("M ").Append(F(p0.X)).Append(' ').Append(F(p0.Y));
        for (var i = 1; i < poly.PointCount; i++)
        {
            var p = poly.Point(i);
            sb.Append(" L ").Append(F(p.X)).Append(' ').Append(F(p.Y));
        }
        if (poly.IsClosed) sb.Append(" Z");
        return sb.ToString();
    }

    private static string ArcToPath(ArcCurve arcCurve)
    {
        var arc = arcCurve.Arc;

        // Full circle: emit two half-arcs (SVG A flag can't draw a full circle in one segment).
        if (Math.Abs(arc.AngleDomain.Length - 2 * Math.PI) < 1e-10)
        {
            var c = arc.Center;
            var r = arc.Radius;
            var sb = new StringBuilder();
            sb.Append("M ").Append(F(c.X + r)).Append(' ').Append(F(c.Y));
            sb.Append(" A ").Append(F(r)).Append(' ').Append(F(r)).Append(" 0 1 0 ")
              .Append(F(c.X - r)).Append(' ').Append(F(c.Y));
            sb.Append(" A ").Append(F(r)).Append(' ').Append(F(r)).Append(" 0 1 0 ")
              .Append(F(c.X + r)).Append(' ').Append(F(c.Y));
            sb.Append(" Z");
            return sb.ToString();
        }

        var start = arc.PointAt(arc.AngleDomain.T0);
        var end = arc.PointAt(arc.AngleDomain.T1);
        var sweep = arc.AngleDomain.Length;
        var largeArc = Math.Abs(sweep) > Math.PI ? 1 : 0;
        // SVG sweep flag: 1 = counter-clockwise in user-space (with Y-flip applied at root, this maps to Rhino CCW).
        var sweepFlag = sweep > 0 ? 1 : 0;
        var sb2 = new StringBuilder();
        sb2.Append("M ").Append(F(start.X)).Append(' ').Append(F(start.Y));
        sb2.Append(" A ").Append(F(arc.Radius)).Append(' ').Append(F(arc.Radius))
           .Append(" 0 ").Append(largeArc).Append(' ').Append(sweepFlag).Append(' ')
           .Append(F(end.X)).Append(' ').Append(F(end.Y));
        return sb2.ToString();
    }

    private static string BezierApproxToPath(Curve curve, double chordTol, double kinkTol)
    {
        var beziers = BezierCurve.CreateCubicBeziers(curve, chordTol, kinkTol);
        if (beziers == null || beziers.Length == 0) return string.Empty;

        var sb = new StringBuilder();
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
                sb.Append("M ").Append(F(p0.X)).Append(' ').Append(F(p0.Y));
                moved = true;
            }
            else
            {
                var dx = last.X - p0.X;
                var dy = last.Y - p0.Y;
                if (dx * dx + dy * dy > 1e-12) sb.Append(" L ").Append(F(p0.X)).Append(' ').Append(F(p0.Y));
            }

            sb.Append(" C ")
              .Append(F(p1.X)).Append(' ').Append(F(p1.Y)).Append(' ')
              .Append(F(p2.X)).Append(' ').Append(F(p2.Y)).Append(' ')
              .Append(F(p3.X)).Append(' ').Append(F(p3.Y));
            last = p3;
        }

        if (curve.IsClosed) sb.Append(" Z");
        return sb.ToString();
    }

    private static string F(double v) => v.ToString("0.######", Inv);
}
