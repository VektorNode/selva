using System;
using System.Collections.Generic;

namespace Selva.Slva;

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
    ///     three double.ToString calls per mesh. Scalars round to 3 decimals. Every serialized
    ///     field must participate, or two materials differing only in it would dedupe into one.
    /// </summary>
    private readonly struct MaterialKey : IEquatable<MaterialKey>
    {
        private readonly int _argb;
        private readonly double _metalness;
        private readonly double _roughness;
        private readonly double _opacity;
        private readonly bool _transparent;
        private readonly string _map;
        private readonly string _roughnessMap;
        private readonly string _normalMap;
        private readonly double? _envMapIntensity;
        private readonly double? _clearcoat;
        private readonly double? _clearcoatRoughness;
        private readonly double? _anisotropy;
        private readonly double? _anisotropyRotation;
        private readonly double? _mapSize;
        private readonly string _finish;
        private readonly double? _finishStrength;
        private readonly double? _transmission;
        private readonly double? _ior;

        public MaterialKey(ThreeMaterial material)
        {
            _argb = material.Color.ToArgb();
            _metalness = Math.Round(material.Metalness, 3);
            _roughness = Math.Round(material.Roughness, 3);
            _opacity = Math.Round(material.Opacity, 3);
            _transparent = material.Transparent;
            _map = material.Map;
            _roughnessMap = material.RoughnessMap;
            _normalMap = material.NormalMap;
            _envMapIntensity = Round(material.EnvMapIntensity);
            _clearcoat = Round(material.Clearcoat);
            _clearcoatRoughness = Round(material.ClearcoatRoughness);
            _anisotropy = Round(material.Anisotropy);
            _anisotropyRotation = Round(material.AnisotropyRotation);
            _mapSize = Round(material.MapSize);
            _finish = material.Finish;
            _finishStrength = Round(material.FinishStrength);
            _transmission = Round(material.Transmission);
            _ior = Round(material.Ior);
        }

        private static double? Round(double? value)
        {
            return value.HasValue ? Math.Round(value.Value, 3) : (double?)null;
        }

        public bool Equals(MaterialKey other)
        {
            return _argb == other._argb
                   && _metalness.Equals(other._metalness)
                   && _roughness.Equals(other._roughness)
                   && _opacity.Equals(other._opacity)
                   && _transparent == other._transparent
                   && string.Equals(_map, other._map, StringComparison.Ordinal)
                   && string.Equals(_roughnessMap, other._roughnessMap, StringComparison.Ordinal)
                   && string.Equals(_normalMap, other._normalMap, StringComparison.Ordinal)
                   && _envMapIntensity == other._envMapIntensity
                   && _clearcoat == other._clearcoat
                   && _clearcoatRoughness == other._clearcoatRoughness
                   && _anisotropy == other._anisotropy
                   && _anisotropyRotation == other._anisotropyRotation
                   && _mapSize == other._mapSize
                   && string.Equals(_finish, other._finish, StringComparison.Ordinal)
                   && _finishStrength == other._finishStrength
                   && _transmission == other._transmission
                   && _ior == other._ior;
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
                hash = hash * 397 ^ (_roughnessMap != null ? StringComparer.Ordinal.GetHashCode(_roughnessMap) : 0);
                hash = hash * 397 ^ (_normalMap != null ? StringComparer.Ordinal.GetHashCode(_normalMap) : 0);
                hash = hash * 397 ^ _envMapIntensity.GetHashCode();
                hash = hash * 397 ^ _clearcoat.GetHashCode();
                hash = hash * 397 ^ _clearcoatRoughness.GetHashCode();
                hash = hash * 397 ^ _anisotropy.GetHashCode();
                hash = hash * 397 ^ _anisotropyRotation.GetHashCode();
                hash = hash * 397 ^ _mapSize.GetHashCode();
                hash = hash * 397 ^ (_finish != null ? StringComparer.Ordinal.GetHashCode(_finish) : 0);
                hash = hash * 397 ^ _finishStrength.GetHashCode();
                hash = hash * 397 ^ _transmission.GetHashCode();
                hash = hash * 397 ^ _ior.GetHashCode();
                return hash;
            }
        }
    }
}
