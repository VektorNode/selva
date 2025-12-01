using System;
using Rhino.Geometry;

namespace Selva.Features.Display.Services;

/// <summary>
///   Optimized mesh processing utilities that combine operations for better performance.
/// </summary>
public static class GeoMeshProcessor
{
  /// <summary>
  ///   Converts a Rhino.Geometry.Mesh into vertex and face arrays in a single pass.
  ///   Combines face counting and array conversion for optimal performance.
  /// </summary>
  /// <param name="mesh">The mesh to convert.</param>
  /// <returns>
  ///   A tuple containing:
  ///   - vertices: Array of vertex coordinates (x, y, z floats)
  ///   - faces: Array of face indices (triangulated)
  /// </returns>
  public static (float[] vertices, int[] faces) ConvertMeshToArrays(Mesh mesh)
  {
    const int verticesPerTriangle = 3;
    const int verticesPerQuad = 6;
    const int componentsPerVertex = 3;

    // First pass: count faces to pre-allocate arrays
    var triangleCount = 0;
    var quadCount = 0;
    foreach (var face in mesh.Faces)
    {
      if (face.IsTriangle)
        triangleCount++;
      else if (face.IsQuad)
        quadCount++;
      else
        Console.WriteLine("NGON detected. This component only supports triangles and quads.");
    }

    var totalIndices = triangleCount * verticesPerTriangle + quadCount * verticesPerQuad;

    var vertices = new float[mesh.Vertices.Count * componentsPerVertex];
    var faces = new int[totalIndices];

    var vertexIndex = 0;
    foreach (var vertex in mesh.Vertices)
    {
      vertices[vertexIndex++] = vertex.X;
      vertices[vertexIndex++] = vertex.Y;
      vertices[vertexIndex++] = vertex.Z;
    }

    // Convert faces (triangulate quads)
    var faceIndex = 0;
    foreach (var face in mesh.Faces)
    {
      if (face.IsTriangle)
      {
        faces[faceIndex++] = face.A;
        faces[faceIndex++] = face.B;
        faces[faceIndex++] = face.C;
      }
      else if (face.IsQuad)
      {
        faces[faceIndex++] = face.A;
        faces[faceIndex++] = face.B;
        faces[faceIndex++] = face.C;
        faces[faceIndex++] = face.C;
        faces[faceIndex++] = face.D;
        faces[faceIndex++] = face.A;
      }
    }

    return (vertices, faces);
  }
}
