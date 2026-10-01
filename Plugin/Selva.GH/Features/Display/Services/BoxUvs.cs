using System;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     The <c>World</c> mapping: a box projection in world millimetres. Each vertex takes the two
///     world axes its normal is furthest from, so a texture lines up across neighbouring parts.
///     Classified per vertex, so a smooth surface turning through 45° smears one row of triangles.
/// </summary>
public static class BoxUvs
{
    // UVs are float32: at 2.6e9 mm (Swiss survey coordinates) the step is 256 mm. Shifting each part
    // by whole kilometres keeps them under 1e6 mm (0.06 mm steps). Parts in different kilometre cells
    // line up only when the texture size divides 1 km.
    private const double CellMm = 1_000_000;

    /// <summary>Replaces the mesh's texture coordinates. Needs vertex normals.</summary>
    public static void Apply(Mesh mesh, double mmPerUnit)
    {
        var min = mesh.GetBoundingBox(false).Min;
        var shift = new Vector3d(Cell(min.X * mmPerUnit), Cell(min.Y * mmPerUnit), Cell(min.Z * mmPerUnit));
        var count = mesh.Vertices.Count;
        var hasNormals = mesh.Normals.Count == count;
        var uvs = new Point2f[count];
        for (var i = 0; i < count; i++)
        {
            var p = (Vector3d)(Point3d)mesh.Vertices[i] * mmPerUnit - shift;
            var n = hasNormals ? (Vector3d)mesh.Normals[i] : Vector3d.ZAxis;
            double ax = Math.Abs(n.X), ay = Math.Abs(n.Y), az = Math.Abs(n.Z);
            // Signs keep each side's texture unmirrored when seen from outside.
            uvs[i] = ax >= ay && ax >= az ? new Point2f((float)(n.X >= 0 ? p.Y : -p.Y), (float)p.Z)
                : ay >= az ? new Point2f((float)(n.Y >= 0 ? -p.X : p.X), (float)p.Z)
                : new Point2f((float)(n.Z >= 0 ? p.X : -p.X), (float)p.Y);
        }

        mesh.TextureCoordinates.Clear();
        mesh.TextureCoordinates.SetTextureCoordinates(uvs);
    }

    private static double Cell(double mm)
    {
        return Math.Floor(mm / CellMm) * CellMm;
    }
}
