using System.Collections.Generic;
using System.Linq;

namespace Selva.Slva;

/// <summary>
///     Encoded geometry blobs from earlier batches, supplied by the host to
///     <see cref="MeshBatchAssembler.CreateBatch" />. The host owns the memory policy; the
///     assembler only reads and fills it.
/// </summary>
public interface IGeometryBlobCache
{
    bool TryGet(GeometryBlobKey key, out byte[] blob);

    void Add(GeometryBlobKey key, byte[] blob);
}

/// <summary>
///     The meshes' <see cref="SlvaMeshInput.ContentKey" />s in the order the blob writes them, plus
///     the unit scale: it decides int16 vs float32, so the same meshes encode differently per unit.
/// </summary>
public sealed class GeometryBlobKey
{
    private readonly object[] _keys;
    private readonly double _metersPerUnit;
    private readonly int _hash;

    private GeometryBlobKey(object[] keys, double metersPerUnit)
    {
        _keys = keys;
        _metersPerUnit = metersPerUnit;
        unchecked
        {
            var hash = 17 * 31 + metersPerUnit.GetHashCode();
            foreach (var key in keys)
            {
                hash = hash * 31 + key.GetHashCode();
            }

            _hash = hash;
        }
    }

    /// <summary>Null when there is nothing to key: no meshes, or any mesh without a key.</summary>
    public static GeometryBlobKey From(IEnumerable<object> contentKeys, double metersPerUnit = 1.0)
    {
        var keys = contentKeys.ToArray();
        return keys.Length == 0 || keys.Any(k => k == null) ? null : new GeometryBlobKey(keys, metersPerUnit);
    }

    public override bool Equals(object obj)
    {
        return obj is GeometryBlobKey other && other._hash == _hash
                                             && other._metersPerUnit.Equals(_metersPerUnit)
                                             && other._keys.SequenceEqual(_keys);
    }

    public override int GetHashCode() => _hash;
}
