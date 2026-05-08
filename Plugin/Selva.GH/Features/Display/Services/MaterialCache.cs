using System.Collections.Generic;
using System.Drawing;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Manages material deduplication by caching unique materials and assigning IDs.
/// </summary>
public class MaterialCache
{
    private readonly List<ThreeMaterial> _materials = new List<ThreeMaterial>();
    private readonly Dictionary<string, int> _materialToId = new Dictionary<string, int>();
    private int _nextId;

    /// <summary>
    ///     Gets the total number of unique materials.
    /// </summary>
    public int Count => _materials.Count;

    /// <summary>
    ///     Gets or creates a material ID for the given material properties.
    ///     If an identical material already exists, returns its ID.
    /// </summary>
    public int GetMaterialId(ThreeMaterial material)
    {
        var key = GetMaterialKey(material);

        if (_materialToId.TryGetValue(key, out var existingId))
        {
            return existingId;
        }

        var newId = _nextId++;
        _materialToId[key] = newId;
        _materials.Add(material);
        return newId;
    }

    /// <summary>
    ///     Gets all unique materials.
    /// </summary>
    public List<ThreeMaterial> GetAllMaterials()
    {
        return _materials;
    }

    /// <summary>
    ///     Creates a unique key for a material based on its properties.
    /// </summary>
    private string GetMaterialKey(ThreeMaterial material)
    {
        // Create a compact key that uniquely identifies the material
        return
            $"{material.Color.ToArgb()}|{material.Metalness:F3}|{material.Roughness:F3}|{material.Opacity:F3}|{material.Transparent}";
    }
}

/// <summary>
///     Represents a batch of meshes optimized for Three.js rendering.
///     Meshes are grouped by material for efficient batching on the web.
/// </summary>
public class MeshBatch
{
    /// <summary>
    ///     Array of unique materials used across all meshes.
    /// </summary>
    [JsonProperty("materials")]
    public List<SerializableMaterial> Materials { get; set; }

    /// <summary>
    ///     Groups of meshes organized by material ID for efficient batching.
    /// </summary>
    [JsonProperty("groups")]
    public List<MaterialGroup> Groups { get; set; }

    /// <summary>
    ///     Binary geometry blob written by <see cref="BinaryGeometryWriter"/>: magic header,
    ///     metadata JSON, quantized int16 (or float32) vertices, and uint32 indices.
    ///     Travels as base64 inside the values JSON for now; will move to an out-of-band binary
    ///     transport in a later phase. Field name is preserved for `.gh` file backward compatibility.
    /// </summary>
    [JsonProperty("compressedData")]
    public byte[] CompressedData { get; set; }

    /// <summary>
    ///     InstanceGuid of the WebDisplay GH component that produced this batch.
    ///     Used for backtracking meshes to their source component.
    /// </summary>
    [JsonProperty("sourceComponentId")]
    public string SourceComponentId { get; set; }
}

/// <summary>
///     A group of meshes sharing the same material.
///     This allows Three.js to merge them into a single BufferGeometry for optimal rendering.
/// </summary>
public class MaterialGroup
{
    /// <summary>
    ///     Reference to the material ID in the materials array.
    /// </summary>
    [JsonProperty("materialId")]
    public int MaterialId { get; set; }

    /// <summary>
    ///     Individual meshes in this group (can be merged or rendered separately).
    /// </summary>
    [JsonProperty("meshes")]
    public List<MeshMetadata> Meshes { get; set; }
}

/// <summary>
///     Metadata for a single mesh within a batch.
/// </summary>
public class MeshMetadata
{
    [JsonProperty("name")] public string Name { get; set; }

    /// <summary>
    ///     Layer path for grouping in the scene manager (e.g. "Structure/Walls").
    /// </summary>
    [JsonProperty("layer")]
    public string Layer { get; set; }

    /// <summary>
    ///     Original index of this mesh in the GH input tree, before material grouping.
    ///     Together with sourceComponentId on MeshBatch, uniquely identifies the GH source.
    /// </summary>
    [JsonProperty("originalIndex")]
    public int OriginalIndex { get; set; }

    /// <summary>
    ///     Number of vertices in this mesh (each vertex is 3 components: x, y, z).
    /// </summary>
    [JsonProperty("vertexCount")]
    public int VertexCount { get; set; }

    /// <summary>
    ///     Number of indices in this mesh (3 per triangle).
    /// </summary>
    [JsonProperty("indexCount")]
    public int IndexCount { get; set; }

    /// <summary>
    ///     Index of this mesh's first vertex in the combined vertex array, in vertex-count units.
    ///     The corresponding component offset into the int16/float32 typed array is VertexStart * 3.
    /// </summary>
    [JsonProperty("vertexStart")]
    public int VertexStart { get; set; }

    /// <summary>
    ///     Index of this mesh's first index in the combined index array, in index-count units.
    /// </summary>
    [JsonProperty("indexStart")]
    public int IndexStart { get; set; }

    [JsonProperty("metadata")] public Dictionary<string, string> Metadata { get; set; }
}

/// <summary>
///     Serializable material that excludes Color (replaced with string hex).
/// </summary>
public class SerializableMaterial
{
    [JsonProperty("color")] public string Color { get; set; }

    [JsonProperty("metalness")] public double Metalness { get; set; }

    [JsonProperty("roughness")] public double Roughness { get; set; }

    [JsonProperty("opacity")] public double Opacity { get; set; }

    [JsonProperty("transparent")] public bool Transparent { get; set; }

    public static SerializableMaterial FromThreeMaterial(ThreeMaterial material)
    {
        return new SerializableMaterial
        {
            Color = ColorTranslator.ToHtml(material.Color),
            Metalness = material.Metalness,
            Roughness = material.Roughness,
            Opacity = material.Opacity,
            Transparent = material.Transparent
        };
    }
}
