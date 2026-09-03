using System;
using System.Collections.Generic;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Turns a Rhino curve into a flat world-space polyline the web renders directly: the reason
///     no browser needs rhino3dm.
///
///     Exact vertices for anything already a polyline, otherwise adaptive subdivision from a
///     uniform seed, stopping on both chord deviation and turn angle. A pure deviation test passes
///     a long, gently-curving span whose endpoints straddle the chord symmetrically; the angle test
///     catches the visible kink at span joints that deviation misses.
/// </summary>
public static class CurveTessellator
{
    /// <summary>Uniform splits before adaptive refinement, so closed/looping curves aren't collapsed.</summary>
    private const int InitialSegments = 12;

    /// <summary>Chord-deviation tolerance as a fraction of the curve's bounding-box diagonal.</summary>
    private const double ChordToleranceRatio = 0.0004;

    /// <summary>Recursion-depth cap per initial span, so a pathological curve can't explode the vertex count.</summary>
    private const int MaxSubdivisionDepth = 12;

    /// <summary>Max turn angle (radians) allowed across a span before it's split.</summary>
    private const double MaxTurnRadians = 0.05;

    /// <summary>
    ///     Flat <c>[x,y,z, x,y,z, …]</c> in world coords, or null if the curve yields fewer than two
    ///     points (nothing renderable).
    /// </summary>
    public static double[] Tessellate(Curve curve)
    {
        if (curve == null || !curve.IsValid)
        {
            return null;
        }

        var points = ExactPolylineVertices(curve) ?? SampleAdaptive(curve);
        if (points.Count < 2)
        {
            return null;
        }

        var flat = new double[points.Count * 3];
        for (var i = 0; i < points.Count; i++)
        {
            flat[i * 3] = points[i].X;
            flat[i * 3 + 1] = points[i].Y;
            flat[i * 3 + 2] = points[i].Z;
        }

        return flat;
    }

    /// <summary>
    ///     Most curves Grasshopper emits are linear, so uniform sampling would needlessly inflate
    ///     them to <see cref="InitialSegments" />+1 points. Returns null when the curve isn't a
    ///     polyline.
    /// </summary>
    private static List<Point3d> ExactPolylineVertices(Curve curve)
    {
        if (!curve.IsPolyline() || !curve.TryGetPolyline(out var polyline) || polyline.Count < 2)
        {
            return null;
        }

        var points = new List<Point3d>(polyline.Count);
        foreach (var p in polyline)
        {
            points.Add(p);
        }

        return points;
    }

    /// <summary>
    ///     Starts from <see cref="InitialSegments" /> uniform spans and recursively subdivides only
    ///     where the curve bends. Tolerance is a fraction of the bounding-box diagonal, so a tiny
    ///     fillet and a huge arc get the same visual smoothness.
    /// </summary>
    private static List<Point3d> SampleAdaptive(Curve curve)
    {
        var domain = curve.Domain;
        var t0 = domain.T0;
        var span = domain.T1 - t0;
        var tolerance = ChordTolerance(curve);

        var ta = t0;
        var pa = curve.PointAt(t0);
        var points = new List<Point3d> { pa };

        for (var i = 0; i < InitialSegments; i++)
        {
            var tb = t0 + span * (i + 1) / InitialSegments;
            var pb = curve.PointAt(tb);
            Subdivide(curve, ta, pa, tb, pb, tolerance, MaxSubdivisionDepth, points);
            points.Add(pb);
            ta = tb;
            pa = pb;
        }

        return points;
    }

    private static void Subdivide(Curve curve, double ta, Point3d pa, double tb, Point3d pb,
        double tolerance, int depth, List<Point3d> points)
    {
        if (depth <= 0)
        {
            return;
        }

        var tm = (ta + tb) / 2;
        var pm = curve.PointAt(tm);

        if (CurveFlatness.DistanceToSegment(pm, pa, pb) <= tolerance
            && CurveFlatness.TurnAngle(pa, pm, pb) <= MaxTurnRadians)
        {
            return;
        }

        Subdivide(curve, ta, pa, tm, pm, tolerance, depth - 1, points);
        points.Add(pm);
        Subdivide(curve, tm, pm, tb, pb, tolerance, depth - 1, points);
    }

    private static double ChordTolerance(Curve curve)
    {
        var box = curve.GetBoundingBox(false);
        var diagonal = box.IsValid ? box.Diagonal.Length : 0.0;
        return Math.Max(diagonal * ChordToleranceRatio, 1e-6);
    }
}
