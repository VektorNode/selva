using System;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Optimized mesh processing utilities that combine operations for better performance.
/// </summary>
public static class GeoMeshProcessor
{
    /// <summary>
    ///     Converts a Rhino.Geometry.Mesh into vertex and face arrays in a single pass.
    ///     Combines face counting and array conversion for optimal performance.
    /// </summary>
    /// <param name="mesh">The mesh to convert.</param>
    /// <returns>
    ///     A tuple containing:
    ///     - vertices: Array of vertex coordinates (x, y, z floats)
    ///     - faces: Array of face indices (triangulated)
    /// </returns>
    public static (float[] vertices, int[] faces) ConvertMeshToArrays(Mesh mesh)
    {
        var (vertices, faces, _, _) = ConvertMeshToArrays(mesh, extractUvs: false, extractColors: false);
        return (vertices, faces);
    }

    /// <summary>
    ///     Same as <see cref="ConvertMeshToArrays(Mesh)" /> but optionally extracts texture
    ///     coordinates and vertex colors. Each channel is returned only when requested AND the
    ///     mesh carries a full set (count == vertex count); partial/absent channels return null,
    ///     so callers can treat null as "mesh has nothing to contribute".
    /// </summary>
    /// <returns>
    ///     - uvs: u,v floats per vertex (vertexCount * 2), or null
    ///     - colors: r,g,b bytes per vertex (vertexCount * 3), or null
    /// </returns>
    public static (float[] vertices, int[] faces, float[] uvs, byte[] colors) ConvertMeshToArrays(
        Mesh mesh, bool extractUvs, bool extractColors)
    {
        const int componentsPerVertex = 3;

        var meshVertices = mesh.Vertices;
        var meshFaces = mesh.Faces;
        var vertexCount = meshVertices.Count;
        var faceCount = meshFaces.Count;

        // Convert vertices via indexed access (foreach over MeshVertexList boxes each Point3f).
        var vertices = new float[vertexCount * componentsPerVertex];
        var vertexIndex = 0;
        for (var i = 0; i < vertexCount; i++)
        {
            var vertex = meshVertices[i];
            vertices[vertexIndex++] = vertex.X;
            vertices[vertexIndex++] = vertex.Y;
            vertices[vertexIndex++] = vertex.Z;
        }

        // Optional channels: only a full per-vertex set is usable (partial sets have no defined
        // mapping onto the combined vertex array), so anything else contributes null.
        float[] uvs = null;
        if (extractUvs && mesh.TextureCoordinates.Count == vertexCount)
        {
            var textureCoords = mesh.TextureCoordinates;
            uvs = new float[vertexCount * 2];
            var uvIndex = 0;
            for (var i = 0; i < vertexCount; i++)
            {
                var tc = textureCoords[i];
                uvs[uvIndex++] = tc.X;
                uvs[uvIndex++] = tc.Y;
            }
        }

        byte[] colors = null;
        if (extractColors && mesh.VertexColors.Count == vertexCount)
        {
            var vertexColors = mesh.VertexColors;
            colors = new byte[vertexCount * 3];
            var colorIndex = 0;
            for (var i = 0; i < vertexCount; i++)
            {
                var c = vertexColors[i];
                colors[colorIndex++] = c.R;
                colors[colorIndex++] = c.G;
                colors[colorIndex++] = c.B;
            }
        }

        // Triangle -> 3 indices, quad -> 6 (two triangles). Counts are O(1) on MeshFaceList, so we
        // size the array exactly without a counting pass and walk the faces only once.
        var faces = new int[meshFaces.TriangleCount * 3 + meshFaces.QuadCount * 6];

        var faceIndex = 0;
        for (var i = 0; i < faceCount; i++)
        {
            var face = meshFaces[i];
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
            else
            {
                Console.WriteLine("NGON detected. This component only supports triangles and quads.");
            }
        }

        return (vertices, faces, uvs, colors);
    }
}
