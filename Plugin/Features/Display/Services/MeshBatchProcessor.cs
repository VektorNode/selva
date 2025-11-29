using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using Rhino.Geometry;

namespace Selva.Features.Display.Services;

/// <summary>
///   Processes meshes in batches with material deduplication and optimized compression.
/// </summary>
public static class MeshBatchProcessor
{
  /// <summary>
  ///   Processes multiple meshes with materials into an optimized batch format.
  ///   Groups meshes by material for efficient Three.js rendering and compresses all data together.
  /// </summary>
  public static MeshBatch CreateBatch(
    List<Mesh> meshes,
    List<string> names,
    List<ThreeMaterial> materials)
  {
    if (meshes.Count == 0)
      throw new ArgumentException("Mesh list cannot be empty");

    if (meshes.Count != names.Count || meshes.Count != materials.Count)
      throw new ArgumentException("Meshes, names, and materials lists must have the same length");

    var materialCache = new MaterialCache();
    var meshesWithMaterials = new List<MeshWithMaterial>();

    // Process all meshes and deduplicate materials
    for (var i = 0; i < meshes.Count; i++)
    {
      var mesh = meshes[i];
      if (mesh == null || !mesh.IsValid) continue;

      var (triangleCount, quadCount) = GeoMeshProcessor.CalculateFaceCounts(mesh);
      var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh, triangleCount, quadCount);
      var materialId = materialCache.GetMaterialId(materials[i]);

      meshesWithMaterials.Add(new MeshWithMaterial
      {
        Name = names[i],
        Vertices = vertices,
        Faces = faces,
        MaterialId = materialId,
        VertexCount = vertices.Length,
        FaceCount = faces.Length
      });
    }

    // Group meshes by material
    var groupedMeshes = meshesWithMaterials
      .GroupBy(m => m.MaterialId)
      .OrderBy(g => g.Key)
      .ToList();

    // Build the batch structure
    var batch = new MeshBatch
    {
      Materials = materialCache.GetAllMaterials()
        .Select(SerializableMaterial.FromThreeMaterial)
        .ToList(),
      Groups = new List<MaterialGroup>()
    };

    // Combine all vertex and face data for compression
    var allVertices = new List<float>();
    var allFaces = new List<int>();
    var currentVertexOffset = 0;
    var currentFaceOffset = 0;

    foreach (var group in groupedMeshes)
    {
      var materialGroup = new MaterialGroup
      {
        MaterialId = group.Key,
        Meshes = new List<MeshMetadata>()
      };

      foreach (var mesh in group)
      {
        // Track metadata with offsets
        materialGroup.Meshes.Add(new MeshMetadata
        {
          Name = mesh.Name,
          VertexCount = mesh.VertexCount,
          FaceCount = mesh.FaceCount,
          VertexOffset = currentVertexOffset,
          FaceOffset = currentFaceOffset
        });

        allVertices.AddRange(mesh.Vertices);
        currentVertexOffset += mesh.VertexCount;

        var baseVertexIndex = currentVertexOffset / 3 - mesh.Vertices.Length / 3;
        var adjustedFaces = mesh.Faces.Select(f => f + baseVertexIndex).ToArray();
        allFaces.AddRange(adjustedFaces);
        currentFaceOffset += mesh.FaceCount;
      }

      batch.Groups.Add(materialGroup);
    }

    batch.CompressedData = CompressGeometryData(allVertices.ToArray(), allFaces.ToArray());

    return batch;
  }

  /// <summary>
  ///   Compresses vertex and face data together using GZip.
  /// </summary>
  private static string CompressGeometryData(float[] vertices, int[] faces)
  {
    byte[] serializedData;

    using (var memoryStream = new MemoryStream())
    {
      using (var writer = new BinaryWriter(memoryStream))
      {
        writer.Write(vertices.Length);
        foreach (var vertex in vertices)
        {
          writer.Write(vertex);
        }

        writer.Write(faces.Length);
        foreach (var index in faces)
        {
          writer.Write(index);
        }
      }

      serializedData = memoryStream.ToArray();
    }

    byte[] compressedData;
    using (var outputStream = new MemoryStream())
    {
      using (var compressionStream = new GZipStream(outputStream, CompressionMode.Compress))
      {
        compressionStream.Write(serializedData, 0, serializedData.Length);
      }

      compressedData = outputStream.ToArray();
    }

    return Convert.ToBase64String(compressedData);
  }
}
