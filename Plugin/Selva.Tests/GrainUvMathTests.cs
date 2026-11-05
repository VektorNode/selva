using System;
using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.Display.Services;
using Xunit;
using static Selva.GH.Features.Display.Services.GrainUvMath;

namespace Selva.Tests;

public class GrainUvMathTests
{
    // A strip of quads, `segments` across, two vertices per station: (station, 0) and (station, 1).
    private static (V3[] positions, V3[] across, List<int>[] neighbours) Strip(
        int segments, Func<int, (V3 p, V3 across)> station, double length)
    {
        var positions = new List<V3>();
        var across = new List<V3>();
        for (var i = 0; i <= segments; i++)
        {
            var (p, a) = station(i);
            positions.Add(p);
            positions.Add(p + new V3(0, 0, length));
            across.Add(a);
            across.Add(a);
        }

        var neighbours = positions.Select(_ => new List<int>()).ToArray();
        void Link(int a, int b)
        {
            neighbours[a].Add(b);
            neighbours[b].Add(a);
        }

        for (var i = 0; i < segments; i++)
        {
            Link(2 * i, 2 * i + 2);
            Link(2 * i + 1, 2 * i + 3);
            Link(2 * i, 2 * i + 1);
        }

        Link(2 * segments, 2 * segments + 1);
        return (positions.ToArray(), across.ToArray(), neighbours);
    }

    [Fact]
    public void Unrolled_equals_the_projection_on_a_flat_piece()
    {
        var (positions, across, neighbours) = Strip(10, i => (new V3(i * 10.0 - 50, 3, 0), new V3(1, 0, 0)), 100);

        var v = Unrolled(positions, across, neighbours);

        for (var i = 0; i < positions.Length; i++)
        {
            Assert.Equal(positions[i].Dot(across[i]), v[i], 9);
        }
    }

    [Fact]
    public void Unrolled_measures_the_arc_of_a_rolled_face()
    {
        // A half tube of radius 100 around the Z grain: the arc is 314 mm, the projection only 200.
        const int segments = 64;
        var (positions, across, neighbours) = Strip(segments, i =>
        {
            var angle = Math.PI * i / segments;
            var p = new V3(100 * Math.Cos(angle), 100 * Math.Sin(angle), 0);
            return (p, new V3(-Math.Sin(angle), Math.Cos(angle), 0));
        }, 50);

        var v = Unrolled(positions, across, neighbours);

        var span = Math.Abs(v[2 * segments] - v[0]);
        Assert.InRange(span, Math.PI * 100 * 0.99, Math.PI * 100 * 1.01);
    }
}
