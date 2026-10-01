using System;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     UVs in millimetres whose U runs along a part's grain and V across it: the <c>Part</c> mapping.
///     Brep surface parameters point U whichever way each surface happened to be built, so two
///     identical strips side by side came out brushed along and across and reflected differently.
///     Exact on flat faces; on a rolled face V is a projection, not the unrolled length.
/// </summary>
public static class GrainUvs
{
    // A face this close to edge-on to the grain (an end cap, a sheet's cut edge) has no grain of its
    // own; U running along the grain would be constant there and give the face no tangent.
    private const double EdgeOnSine = 0.1;

    // Below this share of the normal spread the part is flat, and its normals cannot name an axis.
    private const double FlatShare = 0.02;

    // Used when the material has no Texture Size: the offset only has to differ between parts.
    private const double DefaultOffsetRange = 1000;

    /// <summary>
    ///     A shift in mm, the same for a part on every solve, so neighbouring identical parts don't
    ///     show the same patch of texture. Seeded from the item's id; <c>string.GetHashCode</c> is
    ///     randomized per process on .NET Core, so it would reshuffle every launch.
    /// </summary>
    public static Point2d Offset(string id, double? mapSize)
    {
        var hash = 2166136261u;
        foreach (var c in id ?? "")
        {
            hash = (hash ^ c) * 16777619u;
        }

        var range = mapSize ?? DefaultOffsetRange;
        return new Point2d((hash & 0xFFFF) / 65536.0 * range, (hash >> 16) / 65536.0 * range);
    }

    /// <summary>Replaces the mesh's texture coordinates. Needs vertex normals.</summary>
    public static void Apply(Mesh mesh, double mmPerUnit, Point2d offset)
    {
        var (grain, centre) = Grain(mesh);
        var count = mesh.Vertices.Count;
        var hasNormals = mesh.Normals.Count == count;
        var uvs = new Point2f[count];
        for (var i = 0; i < count; i++)
        {
            var p = (Point3d)mesh.Vertices[i] - centre;
            var n = hasNormals ? (Vector3d)mesh.Normals[i] : Vector3d.ZAxis;
            // Projected into the face, or U shrinks by the sine of the grain's angle to the normal.
            var along = grain - grain * n * n;
            if (along.Length < EdgeOnSine)
            {
                along = grain;
                along.PerpendicularTo(n);
            }

            along.Unitize();
            var across = Vector3d.CrossProduct(n, along);
            across.Unitize();
            uvs[i] = new Point2f(
                (float)(p * along * mmPerUnit + offset.X),
                (float)(p * across * mmPerUnit + offset.Y));
        }

        mesh.TextureCoordinates.Clear();
        mesh.TextureCoordinates.SetTextureCoordinates(uvs);
    }

    /// <summary>
    ///     The direction the part's normals turn around (a folded or rolled sheet's bend axis, which
    ///     is the length of a profile strip), or the longest in-plane extent when the part is flat.
    ///     Area-weighted, so a coarse fold's few facets and a fine one's many count the same.
    /// </summary>
    private static (Vector3d grain, Point3d centre) Grain(Mesh mesh)
    {
        var normals = new double[3, 3];
        var spread = new double[3, 3];
        var area = 0.0;
        var sum = Vector3d.Zero;

        void Add(Point3d a, Point3d b, Point3d c)
        {
            var cross = Vector3d.CrossProduct(b - a, c - a);
            var length = cross.Length;
            if (length == 0)
            {
                return;
            }

            var mid = (Vector3d)(a + b + c) / 3;
            Vector3d va = (Vector3d)a, vb = (Vector3d)b, vc = (Vector3d)c;
            for (var r = 0; r < 3; r++)
            {
                for (var k = 0; k < 3; k++)
                {
                    normals[r, k] += cross[r] * cross[k] / length;
                    // The triangle's exact second moment. Centroids alone tilt the grain: a rectangle
                    // meshed as two triangles has both centroids on its diagonal.
                    spread[r, k] += length / 12 *
                                    (va[r] * va[k] + vb[r] * vb[k] + vc[r] * vc[k] + 9 * mid[r] * mid[k]);
                }
            }

            area += length;
            sum += length * mid;
        }

        var vertices = mesh.Vertices;
        foreach (var face in mesh.Faces)
        {
            Add(vertices[face.A], vertices[face.B], vertices[face.C]);
            if (face.IsQuad)
            {
                Add(vertices[face.C], vertices[face.D], vertices[face.A]);
            }
        }

        if (area == 0)
        {
            return (Vector3d.XAxis, Point3d.Origin);
        }

        var mean = sum / area;
        var (values, axes) = Eigen(normals);
        if (values[1] > FlatShare * (values[0] + values[1] + values[2]))
        {
            return (axes[0], (Point3d)mean);
        }

        // Flat: the principal axis of the area spread within the plane of the two weak normal axes.
        for (var r = 0; r < 3; r++)
        {
            for (var k = 0; k < 3; k++)
            {
                spread[r, k] = spread[r, k] / area - mean[r] * mean[k];
            }
        }

        double Quad(Vector3d x, Vector3d y)
        {
            var q = 0.0;
            for (var r = 0; r < 3; r++)
            {
                for (var k = 0; k < 3; k++)
                {
                    q += x[r] * spread[r, k] * y[k];
                }
            }

            return q;
        }

        var u = axes[0];
        var v = axes[1];
        var angle = 0.5 * Math.Atan2(2 * Quad(u, v), Quad(u, u) - Quad(v, v));
        return (Math.Cos(angle) * u + Math.Sin(angle) * v, (Point3d)mean);
    }

    /// <summary>Cyclic Jacobi on a symmetric 3x3; eigenvalues ascending, unit eigenvectors to match.</summary>
    private static (double[] values, Vector3d[] axes) Eigen(double[,] a)
    {
        var v = new double[3, 3] { { 1, 0, 0 }, { 0, 1, 0 }, { 0, 0, 1 } };
        for (var sweep = 0; sweep < 32; sweep++)
        {
            var off = a[0, 1] * a[0, 1] + a[0, 2] * a[0, 2] + a[1, 2] * a[1, 2];
            var diag = a[0, 0] * a[0, 0] + a[1, 1] * a[1, 1] + a[2, 2] * a[2, 2];
            if (off <= 1e-24 * diag)
            {
                break;
            }

            for (var p = 0; p < 2; p++)
            {
                for (var q = p + 1; q < 3; q++)
                {
                    if (a[p, q] == 0)
                    {
                        continue;
                    }

                    var theta = (a[q, q] - a[p, p]) / (2 * a[p, q]);
                    var t = Math.Sign(theta) / (Math.Abs(theta) + Math.Sqrt(theta * theta + 1));
                    if (theta == 0)
                    {
                        t = 1;
                    }

                    var c = 1 / Math.Sqrt(t * t + 1);
                    var s = t * c;
                    for (var k = 0; k < 3; k++)
                    {
                        var kp = a[k, p];
                        var kq = a[k, q];
                        a[k, p] = c * kp - s * kq;
                        a[k, q] = s * kp + c * kq;
                    }

                    for (var k = 0; k < 3; k++)
                    {
                        var pk = a[p, k];
                        var qk = a[q, k];
                        a[p, k] = c * pk - s * qk;
                        a[q, k] = s * pk + c * qk;
                    }

                    for (var k = 0; k < 3; k++)
                    {
                        var kp = v[k, p];
                        var kq = v[k, q];
                        v[k, p] = c * kp - s * kq;
                        v[k, q] = s * kp + c * kq;
                    }
                }
            }
        }

        var order = new[] { 0, 1, 2 };
        Array.Sort(order, (i, j) => a[i, i].CompareTo(a[j, j]));
        var values = new double[3];
        var axes = new Vector3d[3];
        for (var i = 0; i < 3; i++)
        {
            var col = order[i];
            values[i] = a[col, col];
            axes[i] = new Vector3d(v[0, col], v[1, col], v[2, col]);
            axes[i].Unitize();
        }

        return (values, axes);
    }
}
