using System.Collections.Generic;

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
        // Create a compact key that uniquely identifies the material. Map must participate or two
        // materials differing only by texture would dedupe into one.
        return
            $"{material.Color.ToArgb()}|{material.Metalness:F3}|{material.Roughness:F3}|{material.Opacity:F3}|{material.Transparent}|{material.Map}";
    }
}
