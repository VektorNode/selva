using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Xunit;

namespace Selva.Slva.Tests;

/// <summary>
///     A hit skips the merge and the encode entirely, so the container built around a cached blob
///     must be byte-identical to one built from scratch.
/// </summary>
public class GeometryBlobCacheTests
{
    private sealed class DictionaryCache : IGeometryBlobCache
    {
        public readonly Dictionary<GeometryBlobKey, byte[]> Blobs = new Dictionary<GeometryBlobKey, byte[]>();
        public int Hits;

        public bool TryGet(GeometryBlobKey key, out byte[] blob)
        {
            var hit = Blobs.TryGetValue(key, out blob);
            Hits += hit ? 1 : 0;
            return hit;
        }

        public void Add(GeometryBlobKey key, byte[] blob) => Blobs[key] = blob;
    }

    private static ThreeMaterial Material(Color color)
    {
        var m = ThreeMaterial.Default();
        m.Color = color;
        return m;
    }

    private static SlvaMeshInput Quad(int slot, ThreeMaterial material, bool keyed = true)
    {
        float x = slot * 2;
        return new SlvaMeshInput
        {
            Id = $"c/{{0}}/{slot}",
            Name = slot.ToString(),
            Vertices = new[] { x, 0f, 0f, x + 1f, 0f, 0f, x + 1f, 1f, 0f, x, 1f, 0f },
            Faces = new[] { 0, 1, 2, 0, 2, 3 },
            Material = material,
            ContentKey = keyed ? $"quad{slot}" : null
        };
    }

    private static List<SlvaMeshInput> Quads(params ThreeMaterial[] materials) =>
        materials.Select((m, i) => Quad(i, m)).ToList();

    [Fact]
    public void RecolouredBatch_HitsAndMatchesAFreshEncode()
    {
        var cache = new DictionaryCache();
        var red = Material(Color.Red);
        var blue = Material(Color.Blue);
        MeshBatchAssembler.CreateBatch(Quads(red, red, blue), cache);

        var recoloured = Quads(Material(Color.Green), Material(Color.Green), blue);
        var cached = MeshBatchAssembler.CreateBatch(recoloured, cache);
        var fresh = MeshBatchAssembler.CreateBatch(recoloured);

        Assert.Equal(1, cache.Hits);
        Assert.Equal(fresh.CompressedData, cached.CompressedData);
    }

    [Fact]
    public void Regrouping_KeepsTheGeometry_AndHits()
    {
        var cache = new DictionaryCache();
        var red = Material(Color.Red);
        var blue = Material(Color.Blue);
        MeshBatchAssembler.CreateBatch(Quads(red, blue, red), cache);

        // Slot 1 joins red: the table changes, the geometry written in input order does not.
        var regrouped = MeshBatchAssembler.CreateBatch(Quads(red, red, blue), cache);

        Assert.Equal(1, cache.Hits);
        Assert.Equal(MeshBatchAssembler.CreateBatch(Quads(red, red, blue)).CompressedData, regrouped.CompressedData);
    }

    [Fact]
    public void AnUnkeyedMesh_BypassesTheCache()
    {
        var cache = new DictionaryCache();
        var red = Material(Color.Red);
        var meshes = new List<SlvaMeshInput> { Quad(0, red), Quad(1, red, keyed: false) };

        MeshBatchAssembler.CreateBatch(meshes, cache);
        MeshBatchAssembler.CreateBatch(meshes, cache);

        Assert.Empty(cache.Blobs);
        Assert.Equal(0, cache.Hits);
    }
}
