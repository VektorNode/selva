using System;
using Rhino;
using Rhino.Geometry;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>One Display item, meshed, welded and extracted. Shared across solves: never mutate.</summary>
public sealed class MeshItem
{
    /// <summary>Drawn by the viewport preview.</summary>
    public Mesh Mesh { get; set; }

    public float[] Vertices { get; set; }
    public int[] Faces { get; set; }

    /// <summary>Null when the mesh carries no exported UV channel.</summary>
    public float[] Uvs { get; set; }

    /// <summary>Null when the mesh carries no vertex colours.</summary>
    public byte[] Colors { get; set; }

    /// <summary>Whether meshing produced a full UV set, exported or not. Anisotropy needs it.</summary>
    public bool HasUvs { get; set; }

    public BoundingBox Bounds { get; set; }
}

/// <summary>
///     Display items meshed by earlier solves, keyed by <see cref="MeshItemKey" />, so a material
///     change remeshes nothing. Process-wide: under Rhino.Compute each child holds its own.
/// </summary>
public static class MeshItemCache
{
    // A few hundred smooth Breps fill 256 MB, so a desktop that toggles between two whole-scene
    // variants needs more. Rhino.Compute runs several children, each with its own copy.
    private static readonly ByteBoundedLru<MeshItemKey, MeshItem> Items =
        new ByteBoundedLru<MeshItemKey, MeshItem>(RhinoApp.IsRunningHeadless ? 256L * 1024 * 1024 : 1024L * 1024 * 1024);

    public static (int count, long bytes) Stats => Items.Stats;

    // Leaves the evicted meshes to the GC rather than disposing them: an open document's preview
    // may still draw one.
    public static void Clear() => Items.Clear();

    public static string MeshingKey(MeshingParameters parameters) => parameters.ToEncodedString();

    public static MeshItemKey KeyFor(GeometryBase geom, string meshingKey, double mmPerUnit,
        ThreeMaterial material, bool authoredUvs, string id)
    {
        var bounds = geom.GetBoundingBox(false);
        var elementCount = geom switch
        {
            Mesh m => m.Vertices.Count,
            Brep b => b.Edges.Count,
            _ => 0
        };

        return MeshItemKey.Create(geom.GetType().Name, Crc(geom),
            (bounds.Min.X, bounds.Min.Y, bounds.Min.Z), (bounds.Max.X, bounds.Max.Y, bounds.Max.Z),
            elementCount, geom is Mesh ? null : meshingKey, mmPerUnit, material, authoredUvs, id);
    }

    // A mesh's DataCRC skips vertex colours and texture coordinates, so a recoloured input mesh
    // would hit and keep its old colours.
    private static uint Crc(GeometryBase geom)
    {
        var crc = geom.DataCRC(0);
        if (geom is not Mesh mesh)
        {
            return crc;
        }

        if (mesh.VertexColors.Count > 0)
        {
            crc = Crc(crc, mesh.VertexColors.ToARGBArray());
        }

        return mesh.TextureCoordinates.Count > 0 ? Crc(crc, mesh.TextureCoordinates.ToFloatArray()) : crc;
    }

    // Through a buffer under the large-object-heap threshold: a whole-array byte copy of a big
    // mesh's channels would land on the LOH every solve.
    private static uint Crc(uint crc, Array values)
    {
        const int chunk = 64 * 1024;
        var length = Buffer.ByteLength(values);
        var buffer = new byte[Math.Min(chunk, length)];
        for (var offset = 0; offset < length; offset += chunk)
        {
            var size = Math.Min(chunk, length - offset);
            if (size < buffer.Length)
            {
                buffer = new byte[size];
            }

            Buffer.BlockCopy(values, offset, buffer, 0, size);
            crc = RhinoMath.CRC32(crc, buffer);
        }

        return crc;
    }

    public static bool TryGet(MeshItemKey key, out MeshItem item) => Items.TryGet(key, out item);

    public static void Add(MeshItemKey key, MeshItem item) => Items.Add(key, item, EstimateBytes(item));

    private static long EstimateBytes(MeshItem item)
    {
        var arrayBytes = item.Vertices.Length * 4L + item.Faces.Length * 4L
                                                   + (item.Uvs?.Length ?? 0) * 4L + (item.Colors?.Length ?? 0);
        return item.Mesh.MemoryEstimate() + arrayBytes;
    }
}
