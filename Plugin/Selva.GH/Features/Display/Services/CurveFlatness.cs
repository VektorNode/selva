using System;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     The flatness predicates <see cref="CurveTessellator" /> subdivides on. Split out from it
///     because these are pure point math with no <c>Curve</c> evaluation: that keeps them testable
///     in Selva.Tests, which cannot load RhinoCommon.
/// </summary>
public static class CurveFlatness
{
    /// <summary>
    ///     Turn angle (radians) at <paramref name="b" /> along a→b→c; 0 = straight, π = reversal.
    ///     Returns 0 when either leg has zero length: a repeated point is not a corner.
    /// </summary>
    public static double TurnAngle(Point3d a, Point3d b, Point3d c)
    {
        var ab = b - a;
        var bc = c - b;
        var lenAb = ab.Length;
        var lenBc = bc.Length;
        if (lenAb == 0 || lenBc == 0)
        {
            return 0;
        }

        // Clamp before Acos: rounding on a straight or fully-reversed span can push the quotient
        // a hair past ±1, where Acos returns NaN and every comparison against it goes false.
        var cos = Math.Max(-1, Math.Min(1, (ab * bc) / (lenAb * lenBc)));
        return Math.Acos(cos);
    }

    /// <summary>
    ///     Perpendicular distance from <paramref name="p" /> to segment a→b, clamped to the
    ///     endpoints so a projection falling outside the span measures to the nearer end rather
    ///     than to the infinite line.
    /// </summary>
    public static double DistanceToSegment(Point3d p, Point3d a, Point3d b)
    {
        var ab = b - a;
        var lengthSq = ab.SquareLength;
        if (lengthSq == 0)
        {
            return p.DistanceTo(a);
        }

        var ap = p - a;
        var t = Math.Max(0, Math.Min(1, (ap * ab) / lengthSq));
        return (ap - ab * t).Length;
    }
}
