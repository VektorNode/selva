using System;
using System.Collections.Generic;
using Rhino.Geometry;
using static Selva.GH.Features.Display.Services.GrainUvMath;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     UVs in millimetres whose U runs along a part's grain and V across it: the <c>Part</c> mapping.
///     Brep surface parameters point U whichever way each surface happened to be built, so two
///     identical strips side by side came out brushed along and across and reflected differently.
///     V is unrolled over the surface, so it is the real distance across a rolled face too. On a face
///     cut across the grain U follows the part's widest direction, so end grain lines up with the
///     faces beside it.
/// </summary>
public static class GrainUvs
{
    // A face this close to edge-on to the grain (an end cap, a sheet's cut edge) has no grain of its
    // own; U running along the grain would be constant there and give the face no tangent.
    private const double EdgeOnSine = 0.1;

    // Below this share of the normal spread the part is flat, and its normals cannot name an axis.
    private const double FlatShare = 0.02;

    // A piece whose summed facet normal keeps this share of its area is flat: a mesher's chord error
    // tilts facets of a plane by far less.
    private const double FlatPiece = 0.99;

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

    // A piece this much more spread one way than the other (twice as long as wide) has a direction
    // of its own.
    private const double ElongatedSpread = 4;

    // A piece's own direction wins only when it runs further than this from the part's grain.
    private static readonly double CrossCos = Math.Cos(Math.PI / 4);

    /// <summary>Replaces the mesh's texture coordinates. Needs vertex normals.</summary>
    public static void Apply(Mesh mesh, double mmPerUnit, Point2d offset)
    {
        var (grain, centre, bent) = Grain(mesh);
        var wide = WideAxis(mesh, grain, centre);
        // A bent board runs further around its bend than along the bend axis, and its grain follows
        // the board. A folded profile strip is the other way round and keeps the axis.
        var around = bent && Extent(mesh, wide) > Extent(mesh, grain);
        var count = mesh.Vertices.Count;
        var (pieceOf, pieceGrains) = PieceGrains(mesh, grain);
        var endPiece = around ? EndPieces(mesh, pieceOf, pieceGrains.Length, grain) : null;
        var hasNormals = mesh.Normals.Count == count;
        var positions = new V3[count];
        var alongDirections = new V3[count];
        var acrossDirections = new V3[count];
        for (var i = 0; i < count; i++)
        {
            var p = ((Point3d)mesh.Vertices[i] - centre) * mmPerUnit;
            var n = hasNormals ? (Vector3d)mesh.Normals[i] : Vector3d.ZAxis;
            var piece = pieceOf[i];
            var along = Vector3d.Zero;
            if (around)
            {
                // An end cut's normal runs around the bend, so its U goes along the axis instead:
                // the board's width, as on any end grain.
                along = endPiece[piece] ? grain - grain * n * n : Vector3d.CrossProduct(grain, n);
            }

            if (along.Length < EdgeOnSine)
            {
                var pieceGrain = pieceGrains[piece];
                // Projected into the face, or U shrinks by the sine of the grain's angle to the normal.
                along = pieceGrain - pieceGrain * n * n;
                if (along.Length < EdgeOnSine)
                {
                    along = wide - wide * n * n;
                    if (along.Length < EdgeOnSine)
                    {
                        along = pieceGrain;
                        along.PerpendicularTo(n);
                    }
                }
            }

            along.Unitize();
            var across = Vector3d.CrossProduct(n, along);
            across.Unitize();
            positions[i] = ToV3(p);
            alongDirections[i] = ToV3(along);
            acrossDirections[i] = ToV3(across);
        }

        var neighbours = Neighbours(mesh);
        var u = Unrolled(positions, alongDirections, neighbours);
        var v = Unrolled(positions, acrossDirections, neighbours);

        var uvs = new Point2f[count];
        for (var i = 0; i < count; i++)
        {
            uvs[i] = new Point2f((float)(u[i] + offset.X), (float)(v[i] + offset.Y));
        }

        mesh.TextureCoordinates.Clear();
        mesh.TextureCoordinates.SetTextureCoordinates(uvs);
    }

    // The part's widest direction across the grain: a board's width, never its thickness.
    private static Vector3d WideAxis(Mesh mesh, Vector3d grain, Point3d centre)
    {
        var covariance = new double[3, 3];
        foreach (var vertex in mesh.Vertices)
        {
            var p = (Point3d)vertex - centre;
            var q = p - grain * (p * grain);
            for (var r = 0; r < 3; r++)
            {
                for (var k = 0; k < 3; k++)
                {
                    covariance[r, k] += q[r] * q[k];
                }
            }
        }

        var (_, axes) = Eigen(covariance);
        return axes[2];
    }

    private static double Extent(Mesh mesh, Vector3d direction)
    {
        double min = double.MaxValue, max = double.MinValue;
        foreach (var vertex in mesh.Vertices)
        {
            var d = (Vector3d)(Point3d)vertex * direction;
            min = Math.Min(min, d);
            max = Math.Max(max, d);
        }

        return max - min;
    }

    /// <summary>
    ///     The flat pieces that cut a bent part across its run: an end, narrower around the bend than
    ///     twice the part's thickness. Thickness is twice the volume over the area, so an open sheet has
    ///     none and no ends.
    /// </summary>
    private static bool[] EndPieces(Mesh mesh, int[] pieceOf, int pieces, Vector3d axis)
    {
        var normal = new Vector3d[pieces];
        var area = new double[pieces];
        var volume = 0.0;
        var totalArea = 0.0;
        var vertices = mesh.Vertices;

        void Add(int a, int b, int c)
        {
            Point3d pa = vertices[a], pb = vertices[b], pc = vertices[c];
            var cross = Vector3d.CrossProduct(pb - pa, pc - pa);
            var piece = pieceOf[a];
            normal[piece] += cross;
            area[piece] += cross.Length;
            totalArea += cross.Length / 2;
            volume += (Vector3d)pa * cross / 6;
        }

        foreach (var face in mesh.Faces)
        {
            Add(face.A, face.B, face.C);
            if (face.IsQuad)
            {
                Add(face.C, face.D, face.A);
            }
        }

        var thickness = totalArea > 0 ? 2 * Math.Abs(volume) / totalArea : 0;
        var min = new double[pieces];
        var max = new double[pieces];
        var around = new Vector3d[pieces];
        var end = new bool[pieces];
        for (var piece = 0; piece < pieces; piece++)
        {
            min[piece] = double.MaxValue;
            max[piece] = double.MinValue;
            // Flat: the summed normal keeps its length only when every facet faces the same way.
            end[piece] = area[piece] > 0 && normal[piece].Length > FlatPiece * area[piece];
            around[piece] = Vector3d.CrossProduct(axis, normal[piece] / Math.Max(area[piece], 1e-30));
        }

        for (var i = 0; i < vertices.Count; i++)
        {
            var d = (Vector3d)(Point3d)vertices[i] * around[pieceOf[i]];
            min[pieceOf[i]] = Math.Min(min[pieceOf[i]], d);
            max[pieceOf[i]] = Math.Max(max[pieceOf[i]], d);
        }

        for (var piece = 0; piece < pieces; piece++)
        {
            end[piece] &= around[piece].Length > 1 - EdgeOnSine && max[piece] - min[piece] < 2 * thickness;
        }

        return end;
    }

    private static List<int>[] Neighbours(Mesh mesh)
    {
        var neighbours = new List<int>[mesh.Vertices.Count];
        for (var i = 0; i < neighbours.Length; i++)
        {
            neighbours[i] = new List<int>();
        }

        void Link(int a, int b)
        {
            neighbours[a].Add(b);
            neighbours[b].Add(a);
        }

        foreach (var face in mesh.Faces)
        {
            Link(face.A, face.B);
            Link(face.B, face.C);
            if (face.IsQuad)
            {
                Link(face.C, face.D);
                Link(face.D, face.A);
            }
            else
            {
                Link(face.C, face.A);
            }
        }

        return neighbours;
    }

    private static V3 ToV3(Vector3d v)
    {
        return new V3(v.X, v.Y, v.Z);
    }

    /// <summary>
    ///     The grain for each disjoint piece of the mesh (Web Display appends one per Brep face): the
    ///     piece's own long axis where it is elongated across <paramref name="grain" />, else
    ///     <paramref name="grain" />. A mitred corner turns its normals 90° about the vertical, so
    ///     the part's grain comes out vertical, while each leg's faces still run along the leg.
    /// </summary>
    private static (int[] pieceOf, Vector3d[] grains) PieceGrains(Mesh mesh, Vector3d grain)
    {
        var count = mesh.Vertices.Count;
        var parent = new int[count];
        for (var i = 0; i < count; i++)
        {
            parent[i] = i;
        }

        int Find(int v)
        {
            while (parent[v] != v)
            {
                parent[v] = parent[parent[v]];
                v = parent[v];
            }

            return v;
        }

        void Union(int a, int b)
        {
            parent[Find(a)] = Find(b);
        }

        foreach (var face in mesh.Faces)
        {
            Union(face.A, face.B);
            Union(face.B, face.C);
            if (face.IsQuad)
            {
                Union(face.C, face.D);
            }
        }

        var pieceOf = new int[count];
        var index = new Dictionary<int, int>();
        for (var i = 0; i < count; i++)
        {
            var root = Find(i);
            if (!index.TryGetValue(root, out var piece))
            {
                piece = index.Count;
                index[root] = piece;
            }

            pieceOf[i] = piece;
        }

        var pieces = index.Count;
        var spread = new double[pieces, 3, 3];
        var area = new double[pieces];
        var sum = new Vector3d[pieces];
        var vertices = mesh.Vertices;

        void Add(int piece, Point3d a, Point3d b, Point3d c)
        {
            var length = Vector3d.CrossProduct(b - a, c - a).Length;
            var mid = (Vector3d)(a + b + c) / 3;
            Vector3d va = (Vector3d)a, vb = (Vector3d)b, vc = (Vector3d)c;
            for (var r = 0; r < 3; r++)
            {
                for (var k = 0; k < 3; k++)
                {
                    spread[piece, r, k] += length / 12 *
                                           (va[r] * va[k] + vb[r] * vb[k] + vc[r] * vc[k] + 9 * mid[r] * mid[k]);
                }
            }

            area[piece] += length;
            sum[piece] += length * mid;
        }

        foreach (var face in mesh.Faces)
        {
            var piece = pieceOf[face.A];
            Add(piece, vertices[face.A], vertices[face.B], vertices[face.C]);
            if (face.IsQuad)
            {
                Add(piece, vertices[face.C], vertices[face.D], vertices[face.A]);
            }
        }

        var grains = new Vector3d[pieces];
        for (var piece = 0; piece < pieces; piece++)
        {
            grains[piece] = grain;
            if (area[piece] == 0)
            {
                continue;
            }

            var mean = sum[piece] / area[piece];
            var covariance = new double[3, 3];
            for (var r = 0; r < 3; r++)
            {
                for (var k = 0; k < 3; k++)
                {
                    covariance[r, k] = spread[piece, r, k] / area[piece] - mean[r] * mean[k];
                }
            }

            var (values, axes) = Eigen(covariance);
            if (values[2] > ElongatedSpread * values[1] && Math.Abs(axes[2] * grain) < CrossCos)
            {
                grains[piece] = axes[2];
            }
        }

        return (pieceOf, grains);
    }

    /// <summary>
    ///     The direction the part's normals turn around (a folded or rolled sheet's bend axis, which
    ///     is the length of a profile strip), or the longest in-plane extent when the part is flat.
    ///     Area-weighted, so a coarse fold's few facets and a fine one's many count the same.
    /// </summary>
    private static (Vector3d grain, Point3d centre, bool bent) Grain(Mesh mesh)
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
            return (Vector3d.XAxis, Point3d.Origin, false);
        }

        var mean = sum / area;
        var (values, axes) = Eigen(normals);
        if (values[1] > FlatShare * (values[0] + values[1] + values[2]))
        {
            return (axes[0], (Point3d)mean, true);
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
        return (Math.Cos(angle) * u + Math.Sin(angle) * v, (Point3d)mean, false);
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
