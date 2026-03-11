using System.Collections.Generic;
using System.Drawing;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///     Manages material deduplication by caching unique materials and assigning IDs.
/// </summary>
public class MaterialCache
{
    private readonly List<ThreeMaterial> _materials = new();
    private readonly Dictionary<string, int> _materialToId = new();
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

        if (_materialToId.TryGetValue(key, out var existingId)) return existingId;

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
    ///     Compressed binary data containing all vertices and faces.
    /// </summary>
    [JsonProperty("compressedData")]
    public byte[] CompressedData { get; set; }
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

    [JsonProperty("vertexCount")] public int VertexCount { get; set; }

    [JsonProperty("faceCount")] public int FaceCount { get; set; }

    /// <summary>
    ///     Offset in the combined vertex array (in number of floats, divide by 3 for vertex index).
    /// </summary>
    [JsonProperty("vertexOffset")]
    public int VertexOffset { get; set; }

    /// <summary>
    ///     Offset in the combined face index array (in number of integers).
    /// </summary>
    [JsonProperty("faceOffset")]
    public int FaceOffset { get; set; }

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
