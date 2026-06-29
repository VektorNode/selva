using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
        // Zero meshes is valid: an items-only batch (curves/points, no meshable geometry) still
        // produces a well-formed batch with a valid empty blob (vertexCount = 0). The component
        // sets DisplayBatch.Items afterward.
        if (meshes.Count != names.Count || meshes.Count != materials.Count)
        {
            throw new ArgumentException("Meshes, names, and materials lists must have the same length");
        }

        if (metadataList != null && meshes.Count != metadataList.Count)
        {
            throw new ArgumentException("Metadata list must have the same length as meshes if provided");
        }

        if (layers != null && meshes.Count != layers.Count)
        {
            throw new ArgumentException("Layers list must have the same length as meshes if provided");
        }

        var materialCache = new MaterialCache();

        // Convert meshes and assign material IDs (single conversion, no intermediate storage).
        // Accumulate the combined-array sizes here so we avoid two extra Sum() passes later.
        var processedMeshes = new List<ProcessedMesh>(meshes.Count);
        var totalComponentCount = 0;
        var totalIndexCount = 0;
        for (var i = 0; i < meshes.Count; i++)
        {
            var mesh = meshes[i];
            if (mesh == null || !mesh.IsValid)
            {
                continue;
            }

            var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh);
            var materialId = materialCache.GetMaterialId(materials[i]);

            totalComponentCount += vertices.Length;
            totalIndexCount += faces.Length;

            processedMeshes.Add(new ProcessedMesh
            {
                Name = names[i],
                Layer = layers?[i] ?? "",
                OriginalIndex = i,
                Vertices = vertices,
                Faces = faces,
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

        var componentCursor = 0;          // write head into allVertices, in float components
        var indexCursor = 0;              // write head into allIndices, in indices
        var vertexBaseForIndices = 0;     // number of vertices already in the combined array (rebases per-mesh local indices)

        // processedMeshes is sorted by MaterialId, so a new group starts whenever the id changes.
        MaterialGroup materialGroup = null;
        foreach (var mesh in processedMeshes)
        {
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

            var vertexSpan = allVertices.AsSpan(componentCursor, meshComponentCount);
            mesh.Vertices.AsSpan().CopyTo(vertexSpan);

            var indexSpan = allIndices.AsSpan(indexCursor, meshIndexCount);
            for (var i = 0; i < meshIndexCount; i++)
            {
                indexSpan[i] = mesh.Faces[i] + vertexBaseForIndices;
            }

            componentCursor += meshComponentCount;
            indexCursor += meshIndexCount;
            vertexBaseForIndices += meshVertexCount;
        }

        // Build the binary blob. The metadata JSON inside the blob is a self-contained copy of the
        // batch envelope (without the blob itself), so the format is transport-agnostic — the same
        // bytes can travel inside today's JSON values message or as a future binary WebSocket frame.
        var metadataJson = MeshBatchSerialization.SerializeMetadata(batch);
        using (var ms = new MemoryStream())
        {
            BinaryGeometryWriter.Write(ms, metadataJson, allVertices, allIndices);
            // The blob ships uncompressed over the wire (no transport gzip on dynamic responses or
            // the local WS), so apply an optional gzip pass. Returns the original bytes unchanged
            // when compression doesn't help; the decoder sniffs the leading magic either way.
            batch.CompressedData = BlobCompressor.Compress(ms.ToArray());
        }

        return batch;
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
        public int MaterialId { get; set; }
        public Dictionary<string, string> Metadata { get; set; }
    }
}
