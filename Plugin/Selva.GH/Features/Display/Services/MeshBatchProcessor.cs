using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Processes meshes in batches with material deduplication and optimized compression.
///     Directly processes meshes without intermediate structures for better performance.
/// </summary>
public static class MeshBatchProcessor
{
    /// <summary>
    ///     Processes multiple meshes with materials into an optimized batch format.
    ///     Groups meshes by material for efficient Three.js rendering and compresses all data together.
    /// </summary>
    public static DisplayBatch CreateBatch(
        List<Mesh> meshes,
        List<string> names,
        List<ThreeMaterial> materials,
        List<Dictionary<string, string>> metadataList = null,
        List<string> layers = null,
        string sourceComponentId = null)
    {
        // Convert each mesh to vertex/face arrays here (the legacy serial path). Callers that already
        // extracted the arrays in their own parallel pass should use the overload below to skip this.
        var vertexArrays = new List<float[]>(meshes.Count);
        var faceArrays = new List<int[]>(meshes.Count);
        foreach (var mesh in meshes)
        {
            if (mesh == null || !mesh.IsValid)
            {
                vertexArrays.Add(null);
                faceArrays.Add(null);
                continue;
            }

            var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh);
            vertexArrays.Add(vertices);
            faceArrays.Add(faces);
        }

        return CreateBatch(vertexArrays, faceArrays, names, materials, metadataList, layers,
            sourceComponentId);
    }

    /// <summary>
    ///     Same as <see cref="CreateBatch(List{Mesh},List{string},List{ThreeMaterial},List{Dictionary{string,string}},List{string},string)" />
    ///     but takes vertex/face arrays already extracted from the meshes. The component runs that
    ///     extraction inside its parallel meshing pass, so this overload keeps the serial assembly
    ///     pass free of per-vertex copying. A null entry marks a slot whose mesh was invalid; it is
    ///     skipped, exactly as the mesh-taking overload skips null/invalid meshes.
    ///
    ///     <paramref name="uvArrays" /> / <paramref name="colorArrays" /> optionally carry per-mesh
    ///     texture coordinates (vertexCount * 2 floats) and vertex colors (vertexCount * 3 bytes);
    ///     null lists — or null entries — mean "this mesh has none". When ANY mesh in the batch has
    ///     a channel, the whole batch carries it and the meshes without it get neutral fill
    ///     (UV 0,0 / color white), which delta+deflate compresses to almost nothing and which
    ///     renders identically to no channel at all (white multiplies to identity; a uv attribute
    ///     is inert without a texture). When NO mesh has the channel, nothing is written and the
    ///     blob stays byte-identical to today.
    /// </summary>
    public static DisplayBatch CreateBatch(
        List<float[]> vertexArrays,
        List<int[]> faceArrays,
        List<string> names,
        List<ThreeMaterial> materials,
        List<Dictionary<string, string>> metadataList = null,
        List<string> layers = null,
        string sourceComponentId = null,
        List<float[]> uvArrays = null,
        List<byte[]> colorArrays = null)
    {
        var count = vertexArrays.Count;

        // Zero meshes is valid: an items-only batch (curves/points, no meshable geometry) still
        // produces a well-formed batch with a valid empty blob (vertexCount = 0). The component
        // sets DisplayBatch.Items afterward.
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

        // Assign material IDs and accumulate the combined-array sizes so we avoid two extra Sum()
        // passes later. Vertex/face extraction already happened (parallel pass), so this loop is cheap.
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

        // Order meshes by material id for optimal batching, keeping a stable order within a material
        // (List.Sort isn't stable, so break ties on OriginalIndex). This replaces a GroupBy/OrderBy
        // that allocated intermediate IGrouping objects.
        processedMeshes.Sort((a, b) =>
        {
            var byMat = a.MaterialId.CompareTo(b.MaterialId);
            return byMat != 0 ? byMat : a.OriginalIndex.CompareTo(b.OriginalIndex);
        });

        // Build batch structure
        var batch = new DisplayBatch
        {
            Materials = materialCache.GetAllMaterials()
                .Select(SerializableMaterial.FromThreeMaterial)
                .ToList(),
            Groups = new List<MaterialGroup>(),
            SourceComponentId = sourceComponentId
        };

        // Single allocation for all combined geometry. Lengths are in component/index units:
        //   allVertices: 3 * total vertex count (x,y,z floats)
        //   allIndices:  total index count
        var allVertices = new float[totalComponentCount];
        var allIndices = new int[totalIndexCount];

        // Optional combined channels, allocated only when some mesh carries them. UV fill defaults
        // to (0,0) via array zeroing; colors must be explicitly white (byte default is black).
        var totalVertexCount = totalComponentCount / 3;
        var allUvs = anyUvs ? new float[totalVertexCount * 2] : null;
        byte[] allColors = null;
        if (anyColors)
        {
            allColors = new byte[totalVertexCount * 3];
            allColors.AsSpan().Fill(255); // vectorized white fill (a byte loop was measurable here)
        }

        // Pass A (serial, cheap): walk the sorted meshes once to open material groups, emit the
        // per-mesh metadata, and record each mesh's write offsets into the combined arrays. Group
        // creation and metadata order must stay deterministic, and every offset is a running total,
        // so this pass is inherently sequential — but it only touches per-mesh scalars, never a vertex.
        var offsets = new MeshOffsets[processedMeshes.Count];
        var componentCursor = 0;          // write head into allVertices, in float components
        var indexCursor = 0;              // write head into allIndices, in indices
        var vertexBaseForIndices = 0;     // number of vertices already in the combined array (rebases per-mesh local indices)

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

        // Pass B (expensive, parallel across meshes): the actual per-vertex copying. Pass A gave every
        // mesh a disjoint destination span in each combined array, so the copies never overlap and no
        // locking is needed. This is the intra-branch parallelism: previously a single fat branch
        // merged its whole scene on one thread, which is the common case (most definitions emit one
        // branch), leaving the per-branch Parallel.ForEach upstream with nothing to spread.
        CopyMeshData(processedMeshes, offsets, allVertices, allIndices, allUvs, allColors);

        // Build the binary blob. The metadata JSON inside the blob is a self-contained copy of the
        // batch envelope (without the blob itself), so the format is transport-agnostic — the same
        // bytes can travel inside today's JSON values message or as a future binary WebSocket frame.
        var metadataJson = MeshBatchSerialization.SerializeMetadata(batch);

        // Skip the encode entirely when this exact content was encoded before. A re-solve triggered
        // by an unrelated upstream change (dragging one slider) re-runs this method for every branch,
        // and the branches that didn't change produce byte-identical arrays and metadata. Writing +
        // deflating those again is pure waste; hashing them is a fraction of the cost. See
        // BatchBlobCache for the identity and memory-policy rationale.
        var cacheKey = BlobKey.Compute(metadataJson, allVertices, allIndices, allUvs, allColors);
        var cached = BatchBlobCache.TryGet(cacheKey);
        if (cached != null)
        {
            batch.CompressedData = cached;
            return batch;
        }

        using (var ms = new MemoryStream())
        {
            BinaryGeometryWriter.Write(ms, metadataJson, allVertices, allIndices,
                uvs: allUvs, colors: allColors);
            // The blob ships uncompressed over the wire (no transport gzip on dynamic responses or
            // the local WS), so apply an optional gzip pass. Returns the original bytes unchanged
            // when compression doesn't help; the decoder sniffs the leading magic either way.
            // GetBuffer + length hands the stream's backing array over without a full ToArray copy.
            batch.CompressedData = BlobCompressor.Compress(ms.GetBuffer(), (int)ms.Length);
        }

        BatchBlobCache.Store(cacheKey, batch.CompressedData);

        return batch;
    }

    /// <summary>
    ///     Total combined vertex components below which the merge stays serial. Spinning up
    ///     Parallel.For costs more than it saves on small batches; above this the per-vertex copy
    ///     dominates. ~200k components is roughly 65k vertices — the point where the uint16 index
    ///     path stops applying and batches are unambiguously "fat".
    /// </summary>
    private const int ParallelMergeMinComponents = 200_000;

    /// <summary>
    ///     Copies each mesh's vertices/indices/UVs/colors into its pre-assigned span of the combined
    ///     arrays. Runs in parallel for large batches (see <see cref="ParallelMergeMinComponents" />)
    ///     and serially otherwise; both paths write byte-identical output because every mesh owns a
    ///     disjoint destination range.
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
    ///     Where one mesh writes into the combined arrays. Computed in the serial offset pass so the
    ///     copy pass can run out of order.
    /// </summary>
    private struct MeshOffsets
    {
        /// <summary>Start offset into the combined vertex array, in float components.</summary>
        public int ComponentStart;

        /// <summary>Start offset into the combined index array, in indices.</summary>
        public int IndexStart;

        /// <summary>
        ///     Number of vertices already written by earlier meshes. Rebases this mesh's local
        ///     indices, and (times 2 / times 3) locates its UV and color spans.
        /// </summary>
        public int VertexBase;
    }

    /// <summary>
    ///     Lightweight struct for mesh data during processing (replaces MeshWithMaterial).
    /// </summary>
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
