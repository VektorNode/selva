using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Everything one Display item's meshed output depends on: welded arrays, UVs, colours. Two
///     items with equal keys mesh to identical output, so a material change that leaves the key
///     alone (colour, roughness, finish, texture URL) reuses the mesh.
///     Rhino-free so the material rules can be tested; <see cref="MeshItemCache" /> fingerprints
///     the geometry.
/// </summary>
public sealed record MeshItemKey
{
    private MeshItemKey()
    {
    }

    public string GeometryType { get; private init; }

    // DataCRC is 32 bits; a collision would serve another item's mesh without an error. The bounds
    // and element counts make that require two items of the same size and shape class too.
    public uint Crc { get; private init; }
    public (double x, double y, double z) Min { get; private init; }
    public (double x, double y, double z) Max { get; private init; }
    public int ElementCount { get; private init; }

    /// <summary>Null for mesh input, which is never re-meshed.</summary>
    public string Meshing { get; private init; }

    public double MmPerUnit { get; private init; }
    public UvStep Uvs { get; private init; }

    // Set only on the grain path, where they seed the texture offset. Keying every item on its id
    // would make inserting one item at the front of a branch miss every item after it.
    public double? GrainMapSize { get; private init; }
    public string GrainId { get; private init; }

    public static MeshItemKey Create(string geometryType, uint crc,
        (double x, double y, double z) min, (double x, double y, double z) max, int elementCount,
        string meshing, double mmPerUnit, ThreeMaterial material, bool authoredUvs, string id)
    {
        var uvs = UvSteps.For(material, authoredUvs);
        var grain = uvs == UvStep.Grain;

        return new MeshItemKey
        {
            GeometryType = geometryType,
            Crc = crc,
            Min = min,
            Max = max,
            ElementCount = elementCount,
            Meshing = meshing,
            MmPerUnit = mmPerUnit,
            Uvs = uvs,
            GrainMapSize = grain ? material.MapSize : null,
            GrainId = grain ? id : null
        };
    }
}
