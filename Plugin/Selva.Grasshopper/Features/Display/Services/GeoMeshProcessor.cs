using System;
using System.Collections.Generic;
using System.Linq;
using Rhino.Geometry;

namespace Selva.Grasshopper.Features.Display.Services;

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


		// Convert vertices
		var vertices = new float[mesh.Vertices.Count * componentsPerVertex];
		var vertexIndex = 0;
		foreach (var vertex in mesh.Vertices)
		{
			vertices[vertexIndex++] = vertex.X;
			vertices[vertexIndex++] = vertex.Y;
			vertices[vertexIndex++] = vertex.Z;
		}

		// Convert faces to list to avoid double enumeration
		var faceList = mesh.Faces as IList<MeshFace> ?? mesh.Faces.ToList();

		// Count indices needed
		var totalIndices = 0;
		foreach (var face in faceList)
			if (face.IsTriangle)
				totalIndices += verticesPerTriangle;
			else if (face.IsQuad)
				totalIndices += verticesPerQuad;
			else
				Console.WriteLine("NGON detected. This component only supports triangles and quads.");

		var faces = new int[totalIndices];

		// Convert faces (triangulate quads)
		var faceIndex = 0;
		foreach (var face in faceList)
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

		return (vertices, faces);
	}
}
