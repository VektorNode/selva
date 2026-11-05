using System;
using System.Collections.Generic;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     The Rhino-free half of <see cref="GrainUvs" />: plain doubles, so Selva.Tests can link it.
/// </summary>
public static class GrainUvMath
{
    public readonly record struct V3(double X, double Y, double Z)
    {
        public static V3 operator +(V3 a, V3 b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
        public static V3 operator -(V3 a, V3 b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
        public static V3 operator *(V3 a, double s) => new(a.X * s, a.Y * s, a.Z * s);
        public double Dot(V3 b) => X * b.X + Y * b.Y + Z * b.Z;
        public double Length => Math.Sqrt(Dot(this));
        public V3 Unit => Length > 0 ? this * (1 / Length) : this;
    }

    /// <summary>
    ///     A texture coordinate along each vertex's own direction, unrolled over the surface rather than
    ///     projected. Projecting onto a direction that turns with the surface gives a tube or a bent
    ///     panel a coordinate that barely changes and jumps between facets. Walking the mesh's edges and
    ///     adding each step's length along the direction measures the real distance. Exact on a flat
    ///     piece, where it equals the projection.
    /// </summary>
    /// <param name="neighbours">Vertex adjacency from the mesh's edges.</param>
    public static double[] Unrolled(IReadOnlyList<V3> positions, IReadOnlyList<V3> across,
        IReadOnlyList<int>[] neighbours)
    {
        var count = positions.Count;
        var v = new double[count];
        var done = new bool[count];
        var queue = new Queue<int>();
        for (var seed = 0; seed < count; seed++)
        {
            if (done[seed])
            {
                continue;
            }

            v[seed] = positions[seed].Dot(across[seed]);
            done[seed] = true;
            queue.Enqueue(seed);
            while (queue.Count > 0)
            {
                var i = queue.Dequeue();
                foreach (var j in neighbours[i])
                {
                    if (done[j])
                    {
                        continue;
                    }

                    var direction = across[i] + across[j];
                    direction = direction.Length > 1e-9 ? direction.Unit : across[j];
                    v[j] = v[i] + (positions[j] - positions[i]).Dot(direction);
                    done[j] = true;
                    queue.Enqueue(j);
                }
            }
        }

        return v;
    }
}
