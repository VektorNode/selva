using System;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using Newtonsoft.Json;
using Rhino.Geometry;

namespace Selva.Features.Display.Services;

public static class GeoMeshProcessor
{
  /// <summary>
  ///   Calculates the number of triangle and quad faces in a given mesh.
  /// </summary>
  /// <param name="mesh">The mesh to analyze.</param>
  /// <returns>
  ///   A tuple containing:
  ///   - TriangleCount: The number of triangle faces in the mesh.
  ///   - QuadCount: The number of quad faces in the mesh.
  /// </returns>
  public static (int TriangleCount, int QuadCount) CalculateFaceCounts(Mesh mesh)
  {
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

    return (triangleCount, quadCount);
  }

  /// <summary>
  ///   Converts a Rhino.Geometry.Mesh object into arrays of vertices and faces.
  /// </summary>
  /// <param name="mesh">The mesh to convert.</param>
  /// <param name="triangleCount">The number of triangles in the mesh.</param>
  /// <param name="quadCount">The number of quads in the mesh.</param>
  /// <returns>
  ///   A tuple containing two arrays:
  ///   - vertices: An array of doubles representing the vertex coordinates.
  ///   - faces: An array of integers representing the face indices.
  /// </returns>
  public static (float[] vertices, int[] faces) ConvertMeshToArrays(Mesh mesh, int triangleCount, int quadCount)
  {
    const int verticesPerTriangle = 3;
    const int verticesPerQuad = 6;
    const int componentsPerVertex = 3;

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

  /// <summary>
  ///   Compresses and serializes the given arrays of vertices and face indices. (GZip)
  /// </summary>
  /// <param name="vertices">An array of doubles representing the vertex coordinates.</param>
  /// <param name="faceIndices">An array of integers representing the face indices.</param>
  /// <returns>A base64 encoded string of the compressed and serialized data.</returns>
  public static string CompressAndSerialize(float[] vertices, int[] faceIndices)
  {
    byte[] serializedData;
    //Convert ot float array to reduce size
    using (var memoryStream = new MemoryStream())
    {
      using (var writer = new BinaryWriter(memoryStream))
      {
        writer.Write(vertices.Length);
        foreach (var vertex in vertices)
        {
          writer.Write(vertex);
        }

        writer.Write(faceIndices.Length);
        foreach (var index in faceIndices)
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

  public class ColorJsonConverter : JsonConverter<Color>
  {
    public override void WriteJson(JsonWriter writer, Color value, JsonSerializer serializer)
    {
      writer.WriteValue(ColorTranslator.ToHtml(value));
    }

    public override Color ReadJson(JsonReader reader, Type objectType, Color existingValue, bool hasExistingValue,
      JsonSerializer serializer)
    {
      return ColorTranslator.FromHtml((string)reader.Value);
    }
  }
}
