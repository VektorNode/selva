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
///     Provenance survives the merge. A combined batch has one <c>batchId</c> — the
///     combiner's own, since web pick identity must be unique — so each mesh records where it came
///     from in the <c>gh:*</c> attr columns instead. Those cost about a byte per mesh (the values
///     pool), and answer "which component produced this mesh?" after the sources are gone.
/// </summary>
public static class DisplayBatchCombiner
{
    /// <summary>Attr key: the batchId of the batch a mesh came from.</summary>
    public const string SourceComponentAttr = "gh:component";

    /// <summary>Attr key: the mesh's originalIndex within its source batch.</summary>
    public const string SourceIndexAttr = "gh:originalIndex";

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
    public static Result Combine(IReadOnlyList<DisplayBatch> batches, string batchId)
    {
        if (batches == null)
        {
            throw new ArgumentNullException(nameof(batches));
        }

        var result = new Result();

        var meshInputs = new List<SlvaMeshInput>();
        var items = new List<DisplayItem>();

        // Next provenance ordinal per source batch id, so the count continues across inputs that
        // share one id instead of restarting at 0 for each.
        var nextIndexBySource = new Dictionary<string, int>(StringComparer.Ordinal);

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

            // Ordinal within everything this source id has contributed so far — NOT within this one
            // input, and not meshMeta.OriginalIndex. One Display emitting a tree arrives here as
            // thousands of single-mesh batches that all share its id and all say 0, so any counter
            // that restarts per input leaves every mesh with the same (component, index) pair and
            // identifies nothing. Counting per id keeps the pair unique however the inputs are split.
            var sourceKey = batch.BatchId ?? "";
            if (!nextIndexBySource.TryGetValue(sourceKey, out var indexInSource))
            {
                indexInSource = 0;
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
                    var sourceIndex = indexInSource++;

                    if (!TrySliceMesh(decoded, meshMeta, out var verts, out var faces, out var uvs, out var colors))
                    {
                        continue;
                    }

                    meshInputs.Add(new SlvaMeshInput
                    {
                        Vertices = verts,
                        Faces = faces,
                        Name = meshMeta.Name ?? "",
                        Layer = meshMeta.Layer ?? "",
                        Material = material,
                        Metadata = WithProvenance(meshMeta, batch.BatchId, sourceIndex),
                        Uvs = uvs,
                        Colors = colors
                    });
                }
            }

            nextIndexBySource[sourceKey] = indexInSource;
        }

        if (meshInputs.Count == 0 && items.Count == 0)
        {
            return null;
        }

        var combined = MeshBatchAssembler.CreateBatch(meshInputs, batchId);

        if (items.Count > 0)
        {
            RestampItemIds(items, batchId);
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

    private static Dictionary<string, string> WithProvenance(
        MeshMetadata meta, string batchId, int indexInSource)
    {
        var attrs = meta.Metadata != null
            ? new Dictionary<string, string>(meta.Metadata)
            : new Dictionary<string, string>();

        // Don't overwrite provenance from an earlier combine: the first source is the real one.
        if (!attrs.ContainsKey(SourceComponentAttr) && !string.IsNullOrEmpty(batchId))
        {
            attrs[SourceComponentAttr] = batchId;
        }

        if (!attrs.ContainsKey(SourceIndexAttr))
        {
            attrs[SourceIndexAttr] =
                indexInSource.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return attrs.Count > 0 ? attrs : null;
    }

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

    /// <summary>
    ///     Item ids are <c>{batchId}:{ordinal}</c> and must stay unique within the
    ///     combined batch, so ordinals are reassigned across the merged list.
    /// </summary>
    private static void RestampItemIds(List<DisplayItem> items, string batchId)
    {
        for (var i = 0; i < items.Count; i++)
        {
            items[i].Id = $"{batchId}:{i}";
        }
    }
}
