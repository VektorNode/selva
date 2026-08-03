using System;
using System.Collections.Generic;

namespace Selva.GH.Features.Display.Services;

/// <summary>Dedupes materials, assigning each unique one an ID.</summary>
public class MaterialCache
{
    private readonly List<ThreeMaterial> _materials = new List<ThreeMaterial>();
    private readonly Dictionary<MaterialKey, int> _materialToId = new Dictionary<MaterialKey, int>();
    private int _nextId;

    public int Count => _materials.Count;

    /// <summary>Returns the existing ID for an identical material, or assigns a new one.</summary>
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

    public List<ThreeMaterial> GetAllMaterials()
    {
        return _materials;
    }

    private static MaterialKey GetMaterialKey(ThreeMaterial material)
    {
        return new MaterialKey(material);
    }

    /// <summary>
    ///     Key over the identity-relevant material properties. Runs once per mesh in the batch
    ///     loop, so it must not allocate — a prior string key paid an interpolated string plus
    ///     three double.ToString calls per mesh. Scalars round to 3 decimals; Map must participate
    ///     or two materials differing only by texture would dedupe into one.
    /// </summary>
    private readonly struct MaterialKey : IEquatable<MaterialKey>
    {
        private readonly int _argb;
        private readonly double _metalness;
        private readonly double _roughness;
        private readonly double _opacity;
        private readonly bool _transparent;
        private readonly string _map;

        public MaterialKey(ThreeMaterial material)
        {
            _argb = material.Color.ToArgb();
            _metalness = Math.Round(material.Metalness, 3);
            _roughness = Math.Round(material.Roughness, 3);
            _opacity = Math.Round(material.Opacity, 3);
            _transparent = material.Transparent;
            _map = material.Map;
        }

        public bool Equals(MaterialKey other)
        {
            return _argb == other._argb
                   && _metalness.Equals(other._metalness)
                   && _roughness.Equals(other._roughness)
                   && _opacity.Equals(other._opacity)
                   && _transparent == other._transparent
                   && string.Equals(_map, other._map, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is MaterialKey other && Equals(other);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = _argb;
                hash = hash * 397 ^ _metalness.GetHashCode();
                hash = hash * 397 ^ _roughness.GetHashCode();
                hash = hash * 397 ^ _opacity.GetHashCode();
                hash = hash * 397 ^ _transparent.GetHashCode();
                hash = hash * 397 ^ (_map != null ? StringComparer.Ordinal.GetHashCode(_map) : 0);
                return hash;
            }
        }
    }
}
