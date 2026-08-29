using System.Collections.Generic;
using Rhino.Geometry;
using Selva.Slva;

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
        var inputs = new List<SlvaMeshInput>(meshes.Count);
        for (var i = 0; i < meshes.Count; i++)
        {
            var mesh = meshes[i];
            var valid = mesh != null && mesh.IsValid;
            var (vertices, faces) = valid
                ? GeoMeshProcessor.ConvertMeshToArrays(mesh)
                : (null, null);

            inputs.Add(new SlvaMeshInput
            {
                // Flat slot mint: these OBSOLETE list-based components have no branch structure.
                Id = batchId != null ? $"{batchId}/{i}" : null,
                Vertices = vertices,
                Faces = faces,
                Name = names[i],
                Layer = layers?[i],
                Material = materials[i],
                Metadata = metadataList?[i]
            });
        }

        return MeshBatchAssembler.CreateBatch(inputs);
    }
}
