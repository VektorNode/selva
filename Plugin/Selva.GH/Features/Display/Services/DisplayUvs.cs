using Rhino.Geometry;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     The texture coordinates WebDisplay gives a mesh for its material. Public so a plugin that
///     assembles its own batch runs this step instead of a copy that drifts from it.
/// </summary>
public static class DisplayUvs
{
    /// <summary>
    ///     Replaces the UVs for <see cref="UvMapping.Part" /> and <see cref="UvMapping.World" />;
    ///     <see cref="UvMapping.Surface" /> keeps Rhino's. Needs vertex normals. <paramref name="id" />
    ///     seeds the part's texture offset, so it must be stable across solves.
    ///     <paramref name="authoredUvs" />: the caller vouches the mesh's UVs run along the real
    ///     grain in model units, such as a sheet-metal unroll's flat positions. A grained material
    ///     then uses them instead of guessing the grain from the shape. Never true for a meshed
    ///     Brep, whose UVs are Rhino's 0-1 surface parameters.
    /// </summary>
    public static void Apply(Mesh mesh, ThreeMaterial material, string id, double mmPerUnit,
        bool authoredUvs = false)
    {
        if (material is not { NeedsUvs: true })
        {
            return;
        }

        switch (material.ResolvedMapping)
        {
            case UvMapping.Part or UvMapping.Authored when authoredUvs:
                ScaleToMm(mesh, mmPerUnit);
                break;
            case UvMapping.Authored:
            case UvMapping.Part:
                GrainUvs.Apply(mesh, mmPerUnit, GrainUvs.Offset(id, material.MapSize));
                break;
            case UvMapping.World:
                BoxUvs.Apply(mesh, mmPerUnit);
                break;
        }
    }

    private static void ScaleToMm(Mesh mesh, double mmPerUnit)
    {
        if (mmPerUnit == 1)
        {
            return;
        }

        var uvs = mesh.TextureCoordinates;
        for (var i = 0; i < uvs.Count; i++)
        {
            uvs.SetTextureCoordinate(i, uvs[i].X * mmPerUnit, uvs[i].Y * mmPerUnit);
        }
    }
}
