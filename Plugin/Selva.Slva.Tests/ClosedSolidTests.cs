using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Slva.Tests;

/// <summary>Mirrors closed-solid.test.ts: the writer's answer must be the one the browser would reach.</summary>
public class ClosedSolidTests
{
    // Unit-cube faces, counter-clockwise seen from outside.
    private static readonly int[][] CubeFaces =
    {
        new[] { 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0 },
        new[] { 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1 },
        new[] { 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1 },
        new[] { 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0 },
        new[] { 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0 },
        new[] { 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1 }
    };

    /// <summary>A box whose faces carry their own vertices, as Rhino meshes each Brep face.</summary>
    private static (float[] vertices, int[] faces) Box(double sx, double sy, double sz,
        double ox = 0, double oy = 0, double oz = 0)
    {
        var vertices = new List<float>();
        var faces = new List<int>();
        foreach (var face in CubeFaces)
        {
            var b = vertices.Count / 3;
            for (var c = 0; c < 4; c++)
            {
                vertices.Add((float)(ox + face[c * 3] * sx));
                vertices.Add((float)(oy + face[c * 3 + 1] * sy));
                vertices.Add((float)(oz + face[c * 3 + 2] * sz));
            }

            faces.AddRange(new[] { b, b + 1, b + 2, b, b + 2, b + 3 });
        }

        return (vertices.ToArray(), faces.ToArray());
    }

    /// <summary>Welded UV sphere: single pole vertices, shared seam.</summary>
    private static (float[] vertices, int[] faces) Sphere(int rings, int segments)
    {
        var vertices = new List<float> { 0, 0, 1 };
        for (var r = 1; r < rings; r++)
        {
            var theta = Math.PI * r / rings;
            for (var s = 0; s < segments; s++)
            {
                var phi = 2 * Math.PI * s / segments;
                vertices.Add((float)(Math.Sin(theta) * Math.Cos(phi)));
                vertices.Add((float)(Math.Sin(theta) * Math.Sin(phi)));
                vertices.Add((float)Math.Cos(theta));
            }
        }

        vertices.AddRange(new float[] { 0, 0, -1 });
        var south = vertices.Count / 3 - 1;
        int Ring(int r, int s) => 1 + (r - 1) * segments + (s % segments);

        var faces = new List<int>();
        for (var s = 0; s < segments; s++)
        {
            faces.AddRange(new[] { 0, Ring(1, s), Ring(1, s + 1) });
            faces.AddRange(new[] { south, Ring(rings - 1, s + 1), Ring(rings - 1, s) });
        }

        for (var r = 1; r < rings - 1; r++)
        {
            for (var s = 0; s < segments; s++)
            {
                faces.AddRange(new[] { Ring(r, s), Ring(r + 1, s), Ring(r + 1, s + 1) });
                faces.AddRange(new[] { Ring(r, s), Ring(r + 1, s + 1), Ring(r, s + 1) });
            }
        }

        return (vertices.ToArray(), faces.ToArray());
    }

    private static float NextFloatUp(float value)
    {
        var bits = BitConverter.ToInt32(BitConverter.GetBytes(value), 0);
        return BitConverter.ToSingle(BitConverter.GetBytes(value >= 0 ? bits + 1 : bits - 1), 0);
    }

    [Fact]
    public void WeldsABoxWhoseFacesCarryTheirOwnVertices()
    {
        var (v, f) = Box(1, 0.0005, 1);
        Assert.True(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void AcceptsASphere()
    {
        var (v, f) = Sphere(12, 16);
        Assert.True(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void WeldsNegativeAndPositiveZeroAsOnePosition()
    {
        var (v, f) = Box(2, 2, 2, -1, -1, -1);
        for (var i = 0; i < v.Length; i += 3)
        {
            if (v[i] > 0)
            {
                v[i] = (i / 3) % 2 == 0 ? 0f : -0f;
            }
        }

        Assert.True(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void WeldsSeamCopiesThatRoundedAFloat32StepApart()
    {
        var (v, f) = Box(200, 15, 50, -2032, 2683, 0.97);
        for (var i = 0; i < v.Length; i += 9)
        {
            v[i] = NextFloatUp(v[i]);
        }

        Assert.True(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void KeepsARealGapOpen()
    {
        var (v, f) = Box(200, 15, 50, -2032, 2683, 0.97);
        v[0] += 0.01f; // 10 µm crack in a 200 mm part

        Assert.False(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void RejectsAnOpenBox()
    {
        var (v, f) = Box(1, 1, 1);
        Assert.False(ClosedSolid.IsClosed(v, f.Skip(6).ToArray()));
    }

    [Fact]
    public void RejectsAnInwardWoundBox()
    {
        var (v, f) = Box(1, 1, 1);
        for (var i = 0; i < f.Length; i += 3)
        {
            (f[i + 1], f[i + 2]) = (f[i + 2], f[i + 1]);
        }

        Assert.False(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void RejectsInconsistentWinding()
    {
        var (v, f) = Box(1, 1, 1);
        (f[1], f[2]) = (f[2], f[1]);

        Assert.False(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void RejectsAFlatPlane()
    {
        var v = new float[] { 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0 };
        var f = new[] { 0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2 };

        Assert.False(ClosedSolid.IsClosed(v, f));
    }

    [Fact]
    public void RejectsOutOfRangeIndicesInsteadOfThrowing()
    {
        var (v, f) = Box(1, 1, 1);
        f[5] = 999;

        Assert.False(ClosedSolid.IsClosed(v, f));
    }
}
