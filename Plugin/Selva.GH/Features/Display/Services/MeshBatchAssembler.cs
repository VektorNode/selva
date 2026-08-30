using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Assembles a <see cref="DisplayBatch" /> from already-extracted vertex/face arrays: dedupes
///     materials, groups meshes by material, concatenates them into combined arrays, and encodes
///     the blob.
///
///     Deliberately takes arrays rather than Rhino meshes. Every offset it computes
///     (<c>VertexStart</c>, <c>IndexStart</c>, the index rebase) is what both decoders slice on,
///     and getting one wrong renders the wrong geometry rather than failing — so this half has to
///     be testable without a Rhino host.
/// </summary>
public static class MeshBatchAssembler
{
    /// <summary>
    ///     Assembles a batch from vertex/face arrays already extracted from the meshes, so the
    ///     component's parallel meshing pass does that extraction and this assembly pass stays free
    ///     of per-vertex copying. A null entry marks an invalid mesh's slot and is skipped.
    ///
    ///     <paramref name="uvArrays" /> / <paramref name="colorArrays" /> carry per-mesh UVs
    ///     (vertexCount * 2 floats) and vertex colors (vertexCount * 3 bytes); null lists or
    ///     entries mean "no channel". If ANY mesh has a channel, the whole batch carries it and
    ///     meshes without it get neutral fill (UV 0,0 / color white) — renders identically to no
    ///     channel and compresses to almost nothing. If NO mesh has it, nothing is written and the
    ///     blob stays byte-identical to before this overload existed.
    /// </summary>
    public static DisplayBatch CreateBatch(
        List<float[]> vertexArrays,
        List<int[]> faceArrays,
        List<string> names,
        List<ThreeMaterial> materials,
        List<Dictionary<string, string>> metadataList = null,
        List<string> layers = null,
        string batchId = null,
        List<float[]> uvArrays = null,
        List<byte[]> colorArrays = null)
    {
        var count = vertexArrays.Count;

        // Zero meshes is valid: an items-only batch (curves/points, no meshable geometry) still
        // produces a well-formed batch with an empty blob (vertexCount = 0).
        if (faceArrays.Count != count || count != names.Count || count != materials.Count)
        {
            throw new ArgumentException("Vertex, face, name, and material lists must have the same length");
        }

        if (metadataList != null && count != metadataList.Count)
        {
            throw new ArgumentException("Metadata list must have the same length as meshes if provided");
        }

        if (layers != null && count != layers.Count)
        {
            throw new ArgumentException("Layers list must have the same length as meshes if provided");
        }

        if (uvArrays != null && count != uvArrays.Count)
        {
            throw new ArgumentException("UV list must have the same length as meshes if provided");
        }

        if (colorArrays != null && count != colorArrays.Count)
        {
            throw new ArgumentException("Color list must have the same length as meshes if provided");
        }

        var materialCache = new MaterialCache();

        // Assign material IDs and accumulate combined-array sizes here, to avoid two extra Sum()
        // passes later.
        var processedMeshes = new List<ProcessedMesh>(count);
        var totalComponentCount = 0;
        var totalIndexCount = 0;
        var anyUvs = false;
        var anyColors = false;
        for (var i = 0; i < count; i++)
        {
            var vertices = vertexArrays[i];
            var faces = faceArrays[i];
            if (vertices == null || faces == null)
            {
                continue;
            }

            var materialId = materialCache.GetMaterialId(materials[i]);

            totalComponentCount += vertices.Length;
            totalIndexCount += faces.Length;

            var uvs = uvArrays?[i];
            var colors = colorArrays?[i];
            anyUvs |= uvs != null;
            anyColors |= colors != null;

            processedMeshes.Add(new ProcessedMesh
            {
                Name = names[i],
                Layer = layers?[i] ?? "",
                OriginalIndex = i,
                Vertices = vertices,
                Faces = faces,
                Uvs = uvs,
                Colors = colors,
                MaterialId = materialId,
                Metadata = metadataList?[i]
            });
        }

        // Order by material id for batching; List.Sort isn't stable, so break ties on OriginalIndex
        // to keep a deterministic order within a material.
        processedMeshes.Sort((a, b) =>
        {
            var byMat = a.MaterialId.CompareTo(b.MaterialId);
            return byMat != 0 ? byMat : a.OriginalIndex.CompareTo(b.OriginalIndex);
        });

        var batch = new DisplayBatch
        {
            Materials = materialCache.GetAllMaterials()
                .Select(SerializableMaterial.FromThreeMaterial)
                .ToList(),
            Groups = new List<MaterialGroup>(),
            BatchId = batchId
        };

        var allVertices = new float[totalComponentCount];
        var allIndices = new int[totalIndexCount];

        // Combined channels, allocated only when some mesh carries them. UV fill defaults to
        // (0,0) via array zeroing; colors need an explicit white fill (byte default is black).
        var totalVertexCount = totalComponentCount / 3;
        var allUvs = anyUvs ? new float[totalVertexCount * 2] : null;
        byte[] allColors = null;
        if (anyColors)
        {
            allColors = new byte[totalVertexCount * 3];
            allColors.AsSpan().Fill(255); // vectorized white fill (a byte loop was measurable here)
        }

        // Pass A (serial, cheap): walk the sorted meshes once to open material groups, emit
        // per-mesh metadata, and record each mesh's write offsets into the combined arrays. Every
        // offset is a running total, so this pass is inherently sequential — but it only touches
        // per-mesh scalars, never a vertex.
        var offsets = new MeshOffsets[processedMeshes.Count];
        var componentCursor = 0;         // write head into allVertices, in float components
        var indexCursor = 0;             // write head into allIndices, in indices
        var vertexBaseForIndices = 0;    // vertices already in the combined array; rebases per-mesh local indices

        // processedMeshes is sorted by MaterialId, so a new group starts whenever the id changes.
        MaterialGroup materialGroup = null;
        for (var m = 0; m < processedMeshes.Count; m++)
        {
            var mesh = processedMeshes[m];
            if (materialGroup == null || materialGroup.MaterialId != mesh.MaterialId)
            {
                materialGroup = new MaterialGroup
                {
                    MaterialId = mesh.MaterialId,
                    Meshes = new List<MeshMetadata>()
                };
                batch.Groups.Add(materialGroup);
            }

            var meshComponentCount = mesh.Vertices.Length;
            var meshVertexCount = meshComponentCount / 3;
            var meshIndexCount = mesh.Faces.Length;

            materialGroup.Meshes.Add(new MeshMetadata
            {
                Name = mesh.Name,
                Layer = mesh.Layer,
                OriginalIndex = mesh.OriginalIndex,
                VertexCount = meshVertexCount,
                IndexCount = meshIndexCount,
                VertexStart = vertexBaseForIndices,
                IndexStart = indexCursor,
                Metadata = mesh.Metadata
            });

            offsets[m] = new MeshOffsets
            {
                ComponentStart = componentCursor,
                IndexStart = indexCursor,
                VertexBase = vertexBaseForIndices
            };

            componentCursor += meshComponentCount;
            indexCursor += meshIndexCount;
            vertexBaseForIndices += meshVertexCount;
        }

        // Pass B (expensive, parallel across meshes): the actual per-vertex copying. Pass A gave
        // every mesh a disjoint destination span, so copies never overlap and no locking is
        // needed. This is the intra-branch parallelism that matters when a definition emits a
        // single fat branch — the common case — leaving the per-branch Parallel.ForEach upstream
        // with nothing to spread.
        CopyMeshData(processedMeshes, offsets, allVertices, allIndices, allUvs, allColors);

        // The blob is a self-contained SLVM container: geometry as a nested bare SLVA/SLVZ blob,
        // the object table/materials as binary chunks. The same bytes travel inside a JSON values
        // message or a binary WebSocket frame; items ride the container only in .slvm files.
        using (var ms = new MemoryStream())
        {
            BinaryGeometryWriter.Write(ms, "", allVertices, allIndices,
                uvs: allUvs, colors: allColors);
            // Nothing gzips the blob in transit (no transport gzip on dynamic responses or the
            // local WS), so this applies an optional deflate pass; Compress returns the original
            // bytes unchanged when it doesn't help, and the decoder sniffs the leading magic
            // either way. GetBuffer + length avoids a full ToArray copy of the stream.
            var geometryBlob = BlobCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
            batch.CompressedData = SlvmDocument.Write(batch, geometryBlob, includeItems: false);
        }

        return batch;
    }

    /// <summary>
    ///     Vertex-component threshold below which the merge stays serial — spinning up
    ///     Parallel.For costs more than it saves on small batches. ~200k components is roughly
    ///     65k vertices, past where batches are unambiguously "fat".
    /// </summary>
    private const int ParallelMergeMinComponents = 200_000;

    /// <summary>
    ///     Copies each mesh's vertices/indices/UVs/colors into its pre-assigned span of the
    ///     combined arrays. Parallel above <see cref="ParallelMergeMinComponents" />, serial
    ///     otherwise; both write identical output since every mesh owns a disjoint destination range.
    /// </summary>
    private static void CopyMeshData(
        List<ProcessedMesh> meshes,
        MeshOffsets[] offsets,
        float[] allVertices,
        int[] allIndices,
        float[] allUvs,
        byte[] allColors)
    {
        if (allVertices.Length < ParallelMergeMinComponents || meshes.Count < 2)
        {
            for (var m = 0; m < meshes.Count; m++)
            {
                CopyOneMesh(meshes[m], offsets[m], allVertices, allIndices, allUvs, allColors);
            }

            return;
        }

        Parallel.For(0, meshes.Count,
            m => CopyOneMesh(meshes[m], offsets[m], allVertices, allIndices, allUvs, allColors));
    }

    private static void CopyOneMesh(
        ProcessedMesh mesh,
        MeshOffsets offset,
        float[] allVertices,
        int[] allIndices,
        float[] allUvs,
        byte[] allColors)
    {
        var meshComponentCount = mesh.Vertices.Length;
        var meshVertexCount = meshComponentCount / 3;
        var meshIndexCount = mesh.Faces.Length;

        mesh.Vertices.AsSpan().CopyTo(allVertices.AsSpan(offset.ComponentStart, meshComponentCount));

        // Indices are rebased onto the combined vertex array, so this one can't be a plain copy.
        var indexSpan = allIndices.AsSpan(offset.IndexStart, meshIndexCount);
        var faces = mesh.Faces;
        var vertexBase = offset.VertexBase;
        for (var i = 0; i < meshIndexCount; i++)
        {
            indexSpan[i] = faces[i] + vertexBase;
        }

        if (allUvs != null && mesh.Uvs != null)
        {
            mesh.Uvs.AsSpan().CopyTo(allUvs.AsSpan(vertexBase * 2, meshVertexCount * 2));
        }

        if (allColors != null && mesh.Colors != null)
        {
            mesh.Colors.AsSpan().CopyTo(allColors.AsSpan(vertexBase * 3, meshVertexCount * 3));
        }
    }

    /// <summary>
    ///     Where one mesh writes into the combined arrays, computed in the serial offset pass so
    ///     the copy pass can run out of order.
    /// </summary>
    private struct MeshOffsets
    {
        /// <summary>Offset into the combined vertex array, in float components.</summary>
        public int ComponentStart;

        /// <summary>Offset into the combined index array, in indices.</summary>
        public int IndexStart;

        /// <summary>
        ///     Vertices already written by earlier meshes — rebases this mesh's local indices,
        ///     and (times 2 / times 3) locates its UV and color spans.
        /// </summary>
        public int VertexBase;
    }

    private struct ProcessedMesh
    {
        public string Name { get; set; }
        public string Layer { get; set; }
        public int OriginalIndex { get; set; }
        public float[] Vertices { get; set; }
        public int[] Faces { get; set; }

        /// <summary>Optional u,v floats per vertex; null when this mesh has no texture coordinates.</summary>
        public float[] Uvs { get; set; }

        /// <summary>Optional r,g,b bytes per vertex; null when this mesh has no vertex colors.</summary>
        public byte[] Colors { get; set; }

        public int MaterialId { get; set; }
        public Dictionary<string, string> Metadata { get; set; }
    }
}
