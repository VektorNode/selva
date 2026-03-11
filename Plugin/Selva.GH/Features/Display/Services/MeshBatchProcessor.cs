using System;
using System.Collections.Generic;
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
    public static MeshBatch CreateBatch(
        List<Mesh> meshes,
        List<string> names,
        List<ThreeMaterial> materials,
        List<Dictionary<string, string>> metadataList = null)
    {
        if (meshes.Count == 0) throw new ArgumentException("Mesh list cannot be empty");

        if (meshes.Count != names.Count || meshes.Count != materials.Count)
            throw new ArgumentException("Meshes, names, and materials lists must have the same length");

        if (metadataList != null && meshes.Count != metadataList.Count)
            throw new ArgumentException("Metadata list must have the same length as meshes if provided");

        var materialCache = new MaterialCache();

        // Convert meshes and assign material IDs (single conversion, no intermediate storage)
        var processedMeshes = new List<ProcessedMesh>();
        for (var i = 0; i < meshes.Count; i++)
        {
            var mesh = meshes[i];
            if (mesh == null || !mesh.IsValid) continue;

            var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh);
            var materialId = materialCache.GetMaterialId(materials[i]);

            processedMeshes.Add(new ProcessedMesh
            {
                Name = names[i],
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
        var batch = new MeshBatch
        {
            Materials = materialCache.GetAllMaterials()
                .Select(SerializableMaterial.FromThreeMaterial)
                .ToList(),
            Groups = new List<MaterialGroup>()
        };

        // Calculate total sizes for single allocation
        var totalVertexCount = processedMeshes.Sum(m => m.Vertices.Length);
        var totalFaceCount = processedMeshes.Sum(m => m.Faces.Length);

        // Single allocation for all mesh data
        var allVertices = new float[totalVertexCount];
        var allFaces = new int[totalFaceCount];
        var currentVertexOffset = 0; // Offset in floats
        var currentFaceOffset = 0; // Offset in indices
        var currentVertexCount = 0; // Count of vertices (for face index rebasing)

        // Copy mesh data directly to final arrays
        foreach (var group in groupedMeshes)
        {
            var materialGroup = new MaterialGroup
            {
                MaterialId = group.Key,
                Meshes = new List<MeshMetadata>()
            };

            foreach (var mesh in group)
            {
                var vertexCount = mesh.Vertices.Length;
                var faceCount = mesh.Faces.Length;

                // Track metadata with offsets
                materialGroup.Meshes.Add(new MeshMetadata
                {
                    Name = mesh.Name,
                    VertexCount = vertexCount,
                    FaceCount = faceCount,
                    VertexOffset = currentVertexOffset,
                    FaceOffset = currentFaceOffset,
                    Metadata = mesh.Metadata
                });


                // Copy vertices using Span for optimal performance
                var vertexSpan = allVertices.AsSpan(currentVertexOffset, vertexCount);
                mesh.Vertices.AsSpan().CopyTo(vertexSpan);

                // Adjust face indices and copy
                // mesh.Faces[i] is a vertex index within this mesh (0-based, relative to mesh start)
                // We need to offset it by the number of vertices already in the combined array
                var baseVertexIndex = currentVertexCount; // Number of vertices already in combined array
                var faceSpan = allFaces.AsSpan(currentFaceOffset, faceCount);
                for (var i = 0; i < faceCount; i++) faceSpan[i] = mesh.Faces[i] + baseVertexIndex;

                currentVertexOffset += vertexCount;
                currentFaceOffset += faceCount;
                currentVertexCount += vertexCount / 3; // vertexCount is in floats, divide by 3 to get vertex count
            }

            batch.Groups.Add(materialGroup);
        }

        // Compress all vertex and face data
        batch.CompressedData = CompressionHelper.CompressGeometryData(allVertices, allFaces);

        return batch;
    }

    /// <summary>
    ///     Lightweight struct for mesh data during processing (replaces MeshWithMaterial).
    /// </summary>
    private struct ProcessedMesh
    {
        public string Name { get; set; }
        public float[] Vertices { get; set; }
        public int[] Faces { get; set; }
        public int MaterialId { get; set; }
        public Dictionary<string, string> Metadata { get; set; }
    }
}
