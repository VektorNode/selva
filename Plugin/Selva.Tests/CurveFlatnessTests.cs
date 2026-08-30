using System;
using Rhino.Geometry;
using Selva.GH.Features.Display.Services;

namespace Selva.Tests;

/// <summary>
///     Every failure mode here is silent: a NaN, or a distance measured to the infinite line
///     instead of the segment, makes the flatness check in <c>Subdivide</c> go false and the curve
///     renders subtly wrong rather than throwing.
/// </summary>
public class CurveFlatnessTests
{
    private static Point3d P(double x, double y, double z = 0) => new Point3d(x, y, z);

    // ========================================================================
    // TurnAngle
    // ========================================================================

    [Fact]
    public void TurnAngle_MeasuresTheDeflectionNotTheIncludedAngle()
    {
        // The right angle is ambiguous: deflection and included angle both read pi/2. The second
        // case separates them — a 135-degree included angle is a 45-degree turn.
        Assert.Equal(Math.PI / 2, CurveFlatness.TurnAngle(P(0, 0), P(1, 0), P(1, 1)), 12);
        Assert.Equal(Math.PI / 4, CurveFlatness.TurnAngle(P(0, 0), P(1, 0), P(2, 1)), 12);
    }

    [Fact]
    public void TurnAngle_IsPiForAFullReversal()
    {
        // Acos(-1) sits exactly on the domain edge, where an unclamped quotient returns NaN.
        var angle = CurveFlatness.TurnAngle(P(0, 0), P(1, 0), P(0, 0));

        Assert.False(double.IsNaN(angle));
        Assert.Equal(Math.PI, angle, 9);
    }

    [Fact]
    public void TurnAngle_StaysInDomainForNearlyStraightSpans()
    {
        // The other domain edge: rounding on a near-collinear span pushes the cosine past 1.
        var angle = CurveFlatness.TurnAngle(P(0, 0), P(1e8, 0), P(2e8, 1e-9));

        Assert.False(double.IsNaN(angle));
        Assert.InRange(angle, 0.0, 1e-6);
    }

    [Fact]
    public void TurnAngle_TreatsARepeatedPointAsNoCorner()
    {
        // A collapsed leg leaves the direction undefined; reporting 0 stops a duplicate sample
        // from forcing subdivision that cannot converge.
        Assert.Equal(0.0, CurveFlatness.TurnAngle(P(0, 0), P(0, 0), P(1, 0)), 12);
        Assert.Equal(0.0, CurveFlatness.TurnAngle(P(0, 0), P(1, 0), P(1, 0)), 12);
    }

    // ========================================================================
    // DistanceToSegment
    // ========================================================================

    [Fact]
    public void DistanceToSegment_ClampsToTheNearerEndpointWhenTheProjectionFallsOutside()
    {
        // Both points sit on the infinite line through a→b, so a line-distance test reports 0 —
        // and calls a curve that loops back past its chord flat.
        Assert.Equal(5.0, CurveFlatness.DistanceToSegment(P(-5, 0), P(0, 0), P(10, 0)), 12);
        Assert.Equal(5.0, CurveFlatness.DistanceToSegment(P(15, 0), P(0, 0), P(10, 0)), 12);
    }

    [Fact]
    public void DistanceToSegment_FallsBackToPointDistanceForADegenerateSegment()
    {
        // a == b: nothing to project onto, and the divisor is 0.
        var d = CurveFlatness.DistanceToSegment(P(3, 4), P(0, 0), P(0, 0));

        Assert.False(double.IsNaN(d));
        Assert.Equal(5.0, d, 12);
    }
}
