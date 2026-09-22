using System;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

public static class GeoMeshProcessor
{
    /// <summary>Converts a mesh into flat vertex (x,y,z) and triangulated face-index arrays.</summary>
    public static (float[] vertices, int[] faces) ConvertMeshToArrays(Mesh mesh)
    {
        var (vertices, faces, _, _) = ConvertMeshToArrays(mesh, extractUvs: false, extractColors: false);
        return (vertices, faces);
    }

    /// <summary>
    ///     Same as <see cref="ConvertMeshToArrays(Mesh)" /> but optionally extracts UVs and vertex
    ///     colors. A channel comes back non-null only when requested AND the mesh has a full set
    ///     (count == vertex count): partial or absent channels return null so callers can treat
    ///     null as "this mesh contributes nothing here".
    /// </summary>
    public static (float[] vertices, int[] faces, float[] uvs, byte[] colors) ConvertMeshToArrays(
        Mesh mesh, bool extractUvs, bool extractColors)
    {
        const int componentsPerVertex = 3;

        var meshVertices = mesh.Vertices;
        var meshFaces = mesh.Faces;
        var vertexCount = meshVertices.Count;
        var faceCount = meshFaces.Count;

        // Indexed access, not foreach: MeshVertexList boxes each Point3f in a foreach.
        var vertices = new float[vertexCount * componentsPerVertex];
        var vertexIndex = 0;
        for (var i = 0; i < vertexCount; i++)
        {
            var vertex = meshVertices[i];
            vertices[vertexIndex++] = vertex.X;
            vertices[vertexIndex++] = vertex.Y;
            vertices[vertexIndex++] = vertex.Z;
        }

        // A partial UV/color set has no defined mapping onto the combined vertex array, so only
        // a full per-vertex set is usable; anything else contributes null.
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

        // Triangle -> 3 indices, quad -> 6 (two triangles). TriangleCount/QuadCount are O(1) on
        // MeshFaceList, so the array is sized exactly without a separate counting pass.
        var faces = new int[meshFaces.TriangleCount * 3 + meshFaces.QuadCount * 6];

        var faceIndex = 0;
        var ngonCount = 0;
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
                // Counted, reported once after the loop: a console write per skipped face turned
                // ngon-heavy meshes into an IO storm inside the parallel extraction pass.
                ngonCount++;
            }
        }

        if (ngonCount > 0)
        {
            Console.WriteLine(
                $"Skipped {ngonCount} ngon face(s); this component only supports triangles and quads.");
        }

        return (vertices, faces, uvs, colors);
    }
}
