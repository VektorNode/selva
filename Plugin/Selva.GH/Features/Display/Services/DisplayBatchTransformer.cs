using System.Collections.Generic;
using System.IO;
using Rhino.Geometry;
using Selva.Slva;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Applies a Rhino <see cref="Transform" /> (or <see cref="SpaceMorph" />) to a baked
///     <see cref="DisplayBatch" />, producing a new batch with relocated geometry.
///
///     A WebDisplay holds no live Rhino geometry — meshes live as a quantized binary blob and
///     curves/points as JSON items. To honour Move/Rotate/Scale/Orient on the param, this decodes
///     the blob to world-space vertices, transforms them, and re-encodes a fresh blob; curve/point
///     items are transformed in their own native forms. The batch envelope (materials, groups,
///     layout, ids) stays unchanged — only positions move.
///
///     Mesh indices, group layout, and per-mesh vertex ranges are identity-preserving under any
///     affine transform, so only the vertex array needs to move before re-running the writer. A
///     non-affine <see cref="SpaceMorph" /> morphs vertices point-by-point instead; topology is
///     still preserved, matching how GH morphs an existing mesh.
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
    ///     Decodes the mesh blob, moves its vertices via <paramref name="moveVerts" />, and
    ///     re-encodes with the original metadata envelope. Returns the bytes unchanged if the batch
    ///     has no mesh geometry.
    /// </summary>
    private static byte[] TransformMeshBlob(DisplayBatch batch, System.Action<float[]> moveVerts)
    {
        if (batch.CompressedData == null || batch.CompressedData.Length == 0)
        {
            return batch.CompressedData;
        }

        // Writers have only ever shipped SLVM v2 containers; anything else is foreign bytes.
        // Keep them untouched rather than guessing at a re-encode.
        if (!SlvmDocument.IsSlvm(batch.CompressedData))
        {
            return batch.CompressedData;
        }

        SlvaReader.Result decoded;
        try
        {
            decoded = SlvaReader.Read(batch.CompressedData);
        }
        catch
        {
            // Unreadable blob — keep it as-is rather than dropping the geometry.
            return batch.CompressedData;
        }

        if (decoded.Vertices.Length == 0)
        {
            return batch.CompressedData;
        }

        moveVerts(decoded.Vertices);

        // UVs and vertex colors are invariant under position transforms but must be threaded back
        // through the writer or they'd silently vanish. Re-encode only the geometry blob and swap
        // it into the container — every metadata chunk survives byte-exact.
        using (var ms = new MemoryStream())
        {
            SlvaWriter.Write(ms, "", decoded.Vertices, decoded.Indices,
                uvs: decoded.Uvs, colors: decoded.Colors);
            var geometryBlob = SlvzCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
            return SlvmDocument.ReplaceGeometry(batch.CompressedData, geometryBlob);
        }
    }

    /// <summary>
    ///     Transforms curve/point display items. Curves round-trip through Rhino JSON — the exact
    ///     form, which the tessellated points are re-derived from after the move. Items are
    ///     deep-copied so the source batch stays untouched — GH treats transform as producing a new
    ///     value.
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
                var points = CurveTessellator.Tessellate(curve);
                result.Add(DisplayItem.Curve(json, points, item.Id, item.Name, item.Layer,
                    item.Metadata, item.Color, item.Opacity));
            }
            else if (item.Kind == "curve" && item.Points != null)
            {
                // No NURBS to move — transform the tessellation itself. Exact for affine transforms;
                // a morph bends between samples, but the alternative is dropping the curve.
                result.Add(DisplayItem.Curve(null, MovePoints(item.Points, movePoint), item.Id,
                    item.Name, item.Layer, item.Metadata, item.Color, item.Opacity));
            }
            else if (item.Kind == "point" && item.Position != null)
            {
                var moved = movePoint(new Point3d(item.Position.X, item.Position.Y, item.Position.Z));
                result.Add(RhinoDisplayItems.Point(moved, item.Id, item.Name, item.Layer, item.Metadata,
                    item.Color, item.Opacity));
            }
            else
            {
                result.Add(item);
            }
        }

        return result;
    }

    /// <summary>Moves a flat <c>[x,y,z, …]</c> vertex run through <paramref name="movePoint" />.</summary>
    private static double[] MovePoints(double[] points, System.Func<Point3d, Point3d> movePoint)
    {
        var moved = new double[points.Length];
        for (var i = 0; i + 2 < points.Length; i += 3)
        {
            var p = movePoint(new Point3d(points[i], points[i + 1], points[i + 2]));
            moved[i] = p.X;
            moved[i + 1] = p.Y;
            moved[i + 2] = p.Z;
        }

        return moved;
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
            BatchId = source.BatchId,
            CompressedData = meshBlob,
            Items = items
        };
    }
}
