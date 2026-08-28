using System.Collections.Generic;
using Rhino.Geometry;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Converts Rhino meshes to flat arrays, then hands off to <see cref="MeshBatchAssembler" />.
///     The split keeps the assembly arithmetic free of RhinoCommon so it can be tested.
/// </summary>
public static class MeshBatchProcessor
{
    public static DisplayBatch CreateBatch(
        List<Mesh> meshes,
        List<string> names,
        List<ThreeMaterial> materials,
        List<Dictionary<string, string>> metadataList = null,
        List<string> layers = null,
        string batchId = null)
    {
        // Serial conversion path. Callers that already extracted arrays in their own parallel pass
        // should call MeshBatchAssembler directly to skip this.
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

        return MeshBatchAssembler.CreateBatch(vertexArrays, faceArrays, names, materials, metadataList,
            layers, batchId);
    }
}
