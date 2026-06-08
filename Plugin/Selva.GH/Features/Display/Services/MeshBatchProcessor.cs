using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
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
        if (meshes.Count == 0)
        {
            throw new ArgumentException("Mesh list cannot be empty");
        }

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

        // Convert meshes and assign material IDs (single conversion, no intermediate storage)
        var processedMeshes = new List<ProcessedMesh>();
        for (var i = 0; i < meshes.Count; i++)
        {
            var mesh = meshes[i];
            if (mesh == null || !mesh.IsValid)
            {
                continue;
            }

            var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh);
            var materialId = materialCache.GetMaterialId(materials[i]);

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

        // Group by material for optimal batching
        var groupedMeshes = processedMeshes
            .GroupBy(m => m.MaterialId)
            .OrderBy(g => g.Key)
            .ToList();

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
        var totalComponentCount = processedMeshes.Sum(m => m.Vertices.Length);
        var totalIndexCount = processedMeshes.Sum(m => m.Faces.Length);

        var allVertices = new float[totalComponentCount];
        var allIndices = new int[totalIndexCount];

        var componentCursor = 0;          // write head into allVertices, in float components
        var indexCursor = 0;              // write head into allIndices, in indices
        var vertexBaseForIndices = 0;     // number of vertices already in the combined array (rebases per-mesh local indices)

        foreach (var group in groupedMeshes)
        {
            var materialGroup = new MaterialGroup
            {
                MaterialId = group.Key,
                Meshes = new List<MeshMetadata>()
            };

            foreach (var mesh in group)
            {
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

            batch.Groups.Add(materialGroup);
        }

        // Build the binary blob. The metadata JSON inside the blob is a self-contained copy of the
        // batch envelope (without the blob itself), so the format is transport-agnostic — the same
        // bytes can travel inside today's JSON values message or as a future binary WebSocket frame.
        var metadataJson = SerializeMetadata(batch);
        using (var ms = new MemoryStream())
        {
            BinaryGeometryWriter.Write(ms, metadataJson, allVertices, allIndices);
            batch.CompressedData = ms.ToArray();
        }

        return batch;
    }

    /// <summary>
    ///     Serializes the batch envelope without its own binary blob, for embedding in the blob's
    ///     metadata header. Keeps a single JSON shape so the client decoder doesn't branch on transport.
    /// </summary>
    private static string SerializeMetadata(DisplayBatch batch)
    {
        var savedBlob = batch.CompressedData;
        batch.CompressedData = null;
        try
        {
            return JsonConvert.SerializeObject(batch);
        }
        finally
        {
            batch.CompressedData = savedBlob;
        }
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
