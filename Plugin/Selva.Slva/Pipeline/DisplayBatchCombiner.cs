using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Slva;

/// <summary>
///     Merges several <see cref="DisplayBatch" />es into one.
///
///     Full re-encode, not a blob concatenation: every input's geometry is decoded, concatenated,
///     and re-quantized over the union bounding box. Keeping each input's own grid would leave the
///     result with mixed quantization scales and a blob that deflates worse, so the combine pays a
///     decode + encode to emit one optimal batch.
///
///     Identity passes through untouched: each object's <see cref="MeshMetadata.Id" /> already
///     names its producer, so combined batches from many sources stay collision-free and hidden
///     state in the viewer survives the combine.
/// </summary>
public static class DisplayBatchCombiner
{
    public sealed class Result
    {
        public DisplayBatch Batch { get; set; }

        /// <summary>Inputs skipped because their blob wouldn't decode. Surfaced as a warning.</summary>
        public List<string> Failures { get; } = new List<string>();

        public int MeshCount { get; set; }
        public int MaterialCount { get; set; }
        public int ItemCount { get; set; }
    }

    /// <summary>
    ///     Combines the batches into one. Returns null when nothing decodable was supplied.
    ///     Materials dedupe across inputs, so two batches sharing a material produce one group.
    /// </summary>
    public static Result Combine(IReadOnlyList<DisplayBatch> batches)
    {
        if (batches == null)
        {
            throw new ArgumentNullException(nameof(batches));
        }

        var result = new Result();

        var meshInputs = new List<SlvaMeshInput>();
        var items = new List<DisplayItem>();

        for (var b = 0; b < batches.Count; b++)
        {
            var batch = batches[b];
            if (batch == null)
            {
                continue;
            }

            AppendItems(batch, items);

            if (batch.Groups == null || batch.CompressedData == null || batch.CompressedData.Length == 0)
            {
                continue;
            }

            SlvaReader.Result decoded;
            try
            {
                decoded = SlvaReader.Read(batch.CompressedData);
            }
            catch (Exception ex)
            {
                result.Failures.Add($"input {b}: {ex.Message}");
                continue;
            }

            foreach (var group in batch.Groups)
            {
                if (group.Meshes == null)
                {
                    continue;
                }

                var material = MaterialAt(batch, group.MaterialId);
                foreach (var meshMeta in group.Meshes)
                {
                    if (!TrySliceMesh(decoded, meshMeta, out var verts, out var faces, out var uvs, out var colors))
                    {
                        continue;
                    }

                    meshInputs.Add(new SlvaMeshInput
                    {
                        Id = meshMeta.Id,
                        Vertices = verts,
                        Faces = faces,
                        Name = meshMeta.Name ?? "",
                        Layer = meshMeta.Layer ?? "",
                        Material = material,
                        Metadata = meshMeta.Metadata,
                        Uvs = uvs,
                        Colors = colors
                    });
                }
            }
        }

        if (meshInputs.Count == 0 && items.Count == 0)
        {
            return null;
        }

        var combined = MeshBatchAssembler.CreateBatch(meshInputs);

        if (items.Count > 0)
        {
            combined.Items = items;
        }

        result.Batch = combined;
        result.MeshCount = meshInputs.Count;
        result.MaterialCount = combined.Materials?.Count ?? 0;
        result.ItemCount = items.Count;
        return result;
    }

    // ============================================================================
    // MESH SLICING
    // ============================================================================

    /// <summary>
    ///     Copies one mesh's window out of a decoded batch into standalone arrays, rebasing its
    ///     indices to zero. Returns false for a window the decoded arrays can't satisfy — a
    ///     corrupt table shouldn't take the whole combine down with it.
    /// </summary>
    private static bool TrySliceMesh(
        SlvaReader.Result decoded, MeshMetadata meta,
        out float[] vertices, out int[] faces, out float[] uvs, out byte[] colors)
    {
        vertices = null;
        faces = null;
        uvs = null;
        colors = null;

        var vStart = meta.VertexStart;
        var vCount = meta.VertexCount;
        var iStart = meta.IndexStart;
        var iCount = meta.IndexCount;

        if (vStart < 0 || vCount <= 0 || iStart < 0 || iCount <= 0 ||
            (vStart + vCount) * 3 > decoded.Vertices.Length ||
            iStart + iCount > decoded.Indices.Length)
        {
            return false;
        }

        vertices = new float[vCount * 3];
        Array.Copy(decoded.Vertices, vStart * 3, vertices, 0, vCount * 3);

        faces = new int[iCount];
        for (var i = 0; i < iCount; i++)
        {
            var rebased = decoded.Indices[iStart + i] - vStart;
            if (rebased < 0 || rebased >= vCount)
            {
                return false;
            }

            faces[i] = rebased;
        }

        if (decoded.Uvs != null && (vStart + vCount) * 2 <= decoded.Uvs.Length)
        {
            uvs = new float[vCount * 2];
            Array.Copy(decoded.Uvs, vStart * 2, uvs, 0, vCount * 2);
        }

        if (decoded.Colors != null && (vStart + vCount) * 3 <= decoded.Colors.Length)
        {
            colors = new byte[vCount * 3];
            Array.Copy(decoded.Colors, vStart * 3, colors, 0, vCount * 3);
        }

        return true;
    }

    // ============================================================================
    // METADATA
    // ============================================================================

    private static ThreeMaterial MaterialAt(DisplayBatch batch, int materialId)
    {
        if (batch.Materials != null && materialId >= 0 && materialId < batch.Materials.Count)
        {
            return batch.Materials[materialId].ToThreeMaterial();
        }

        return ThreeMaterial.Default();
    }

    // ============================================================================
    // ITEMS
    // ============================================================================

    private static void AppendItems(DisplayBatch batch, List<DisplayItem> items)
    {
        if (batch.Items == null)
        {
            return;
        }

        foreach (var item in batch.Items)
        {
            if (item != null)
            {
                items.Add(item);
            }
        }
    }
}
