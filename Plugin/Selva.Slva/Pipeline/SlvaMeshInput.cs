using System.Collections.Generic;

namespace Selva.Slva;

/// <summary>
///     One mesh going into <see cref="MeshBatchAssembler.CreateBatch" />. Everything about a mesh
///     travels in one object, so per-mesh data can't end up misaligned across parallel lists.
/// </summary>
public sealed class SlvaMeshInput
{
    /// <summary>World-space x,y,z floats, 3 per vertex. Null marks an invalid slot: skipped.</summary>
    public float[] Vertices { get; set; }

    /// <summary>Triangle vertex indices, local to this mesh, 3 per triangle. Null marks an invalid slot.</summary>
    public int[] Faces { get; set; }

    public string Name { get; set; }

    /// <summary>Layer path for grouping in the scene manager (e.g. "Structure/Walls").</summary>
    public string Layer { get; set; }

    public ThreeMaterial Material { get; set; }

    /// <summary>Per-mesh attrs (TABL sparse columns). Namespace keys by convention: "myapp:key".</summary>
    public Dictionary<string, string> Metadata { get; set; }

    /// <summary>Optional u,v floats per vertex (vertexCount * 2); null = this mesh has none.</summary>
    public float[] Uvs { get; set; }

    /// <summary>Optional r,g,b bytes per vertex (vertexCount * 3); null = this mesh has none.</summary>
    public byte[] Colors { get; set; }
}
