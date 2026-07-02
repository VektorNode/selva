using System.Collections.Generic;
using System.IO;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Applies a Rhino <see cref="Transform" /> (or <see cref="SpaceMorph" />) to a baked
///     <see cref="DisplayBatch" />, producing a new batch with relocated geometry.
///
///     A WebDisplay holds no live Rhino geometry — meshes live as a quantized binary blob and
///     curves/points as JSON items. To honour Move/Rotate/Scale/Orient on the param (the natural
///     Grasshopper expectation), we decode the blob to world-space vertices, transform them, and
///     re-encode a fresh blob; curve/point items are transformed in their own native forms. The
///     batch envelope (materials, groups, layout, ids) is preserved unchanged — only positions move.
///
///     Mesh indices, group layout, and per-mesh vertex ranges are identity-preserving under any
///     affine transform, so we only need to move the vertex array and re-run the writer. For a
///     non-affine <see cref="SpaceMorph" /> the vertices are morphed point-by-point; topology is
///     still preserved (display meshes are not refined), which matches how GH morphs an existing mesh.
/// </summary>
public static class DisplayBatchTransformer
{
    public static DisplayBatch Transform(DisplayBatch batch, Transform xform)
    {
        if (batch == null)
        {
            return null;
        }

        var meshBlob = TransformMeshBlob(batch, verts => ApplyTransform(verts, xform));
        var items = TransformItems(batch.Items, c => c.Transform(xform), p => { p.Transform(xform); return p; });
        return Rebuild(batch, meshBlob, items);
    }

    public static DisplayBatch Morph(DisplayBatch batch, SpaceMorph morph)
    {
        if (batch == null)
        {
            return null;
        }

        var meshBlob = TransformMeshBlob(batch, verts => ApplyMorph(verts, morph));
        var items = TransformItems(batch.Items,
            c => { morph.Morph(c); return true; },
            p => morph.MorphPoint(p));
        return Rebuild(batch, meshBlob, items);
    }

    /// <summary>
    ///     Decodes the mesh blob, moves its vertices via <paramref name="moveVerts" />, and re-encodes
    ///     a new SLVA(/SLVZ) blob with the original metadata envelope. Returns the original bytes
    ///     unchanged when the batch has no mesh geometry.
    /// </summary>
    private static byte[] TransformMeshBlob(DisplayBatch batch, System.Action<float[]> moveVerts)
    {
        if (batch.CompressedData == null || batch.CompressedData.Length == 0)
        {
            return batch.CompressedData;
        }

        BinaryGeometryReader.Result decoded;
        try
        {
            decoded = BinaryGeometryReader.Read(batch.CompressedData);
        }
        catch
        {
            // Unreadable blob: leave it as-is rather than dropping the geometry.
            return batch.CompressedData;
        }

        if (decoded.Vertices.Length == 0)
        {
            return batch.CompressedData;
        }

        moveVerts(decoded.Vertices);

        // Re-embed the same metadata envelope the original blob carried, so the re-encoded blob is
        // self-contained exactly like the writer's output. UVs and vertex colors are invariant
        // under position transforms but must be threaded back through or they'd silently vanish.
        var metadataJson = MeshBatchSerialization.SerializeMetadata(batch);
        using (var ms = new MemoryStream())
        {
            BinaryGeometryWriter.Write(ms, metadataJson, decoded.Vertices, decoded.Indices,
                uvs: decoded.Uvs, colors: decoded.Colors);
            return BlobCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
        }
    }

    /// <summary>
    ///     Transforms curve/point display items. Curves round-trip through Rhino JSON (the only form
    ///     the item carries); points move their stored position. Items are deep-copied so the source
    ///     batch is left untouched — GH treats transform as producing a new value.
    /// </summary>
    private static List<DisplayItem> TransformItems(
        List<DisplayItem> items,
        System.Func<Curve, bool> moveCurve,
        System.Func<Point3d, Point3d> movePoint)
    {
        if (items == null)
        {
            return null;
        }

        var result = new List<DisplayItem>(items.Count);
        foreach (var item in items)
        {
            if (item == null)
            {
                continue;
            }

            if (item.Kind == "curve" && !string.IsNullOrEmpty(item.Json)
                && GeometryBase.FromJSON(item.Json) is Curve curve)
            {
                moveCurve(curve);
                var json = curve.ToNurbsCurve()?.ToJSON(new Rhino.FileIO.SerializationOptions()) ?? item.Json;
                result.Add(DisplayItem.Curve(json, item.Id, item.Name, item.Layer, item.Metadata,
                    item.Color, item.Opacity));
            }
            else if (item.Kind == "point" && item.Position != null)
            {
                var moved = movePoint(new Point3d(item.Position.X, item.Position.Y, item.Position.Z));
                result.Add(DisplayItem.Point(moved, item.Id, item.Name, item.Layer, item.Metadata,
                    item.Color, item.Opacity));
            }
            else
            {
                result.Add(item);
            }
        }

        return result;
    }

    private static void ApplyTransform(float[] verts, Transform xform)
    {
        for (var i = 0; i < verts.Length; i += 3)
        {
            var p = new Point3d(verts[i], verts[i + 1], verts[i + 2]);
            p.Transform(xform);
            verts[i] = (float)p.X;
            verts[i + 1] = (float)p.Y;
            verts[i + 2] = (float)p.Z;
        }
    }

    private static void ApplyMorph(float[] verts, SpaceMorph morph)
    {
        for (var i = 0; i < verts.Length; i += 3)
        {
            var p = morph.MorphPoint(new Point3d(verts[i], verts[i + 1], verts[i + 2]));
            verts[i] = (float)p.X;
            verts[i + 1] = (float)p.Y;
            verts[i + 2] = (float)p.Z;
        }
    }

    /// <summary>Clones the batch envelope, swapping in the transformed blob and items.</summary>
    private static DisplayBatch Rebuild(DisplayBatch source, byte[] meshBlob, List<DisplayItem> items)
    {
        return new DisplayBatch
        {
            Materials = source.Materials,
            Groups = source.Groups,
            SourceComponentId = source.SourceComponentId,
            CompressedData = meshBlob,
            Items = items
        };
    }
}
