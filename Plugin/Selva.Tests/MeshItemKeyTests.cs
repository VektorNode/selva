using System.Drawing;
using Selva.GH.Features.Display.Services;
using Selva.Slva;

namespace Selva.Tests;

/// <summary>
///     A key that ignores something the mesh depends on serves a stale mesh without an error; one
///     that includes something it doesn't remeshes for nothing. These pin which material fields
///     land on which side.
/// </summary>
public class MeshItemKeyTests
{
    private static MeshItemKey Key(ThreeMaterial material, string id = "c/{0}/0", bool authoredUvs = false,
        uint crc = 42, string meshing = "fast", double mmPerUnit = 1)
    {
        return MeshItemKey.Create("Brep", crc, (0, 0, 0), (1, 1, 1), 12, meshing, mmPerUnit, material,
            authoredUvs, id);
    }

    private static ThreeMaterial Textured(UvMapping mapping = UvMapping.Part, double? mapSize = 500)
    {
        var material = ThreeMaterial.Default();
        material.Map = "https://example.com/wood.jpg";
        material.Mapping = mapping;
        material.MapSize = mapSize;
        return material;
    }

    [Fact]
    public void AppearanceOnlyChanges_KeepTheKey()
    {
        var before = Textured();
        var after = Textured();
        after.Color = Color.Red;
        after.Roughness = 0.1;
        after.Metalness = 1;
        after.Opacity = 0.5;
        after.Map = "https://example.com/stone.jpg";
        after.Clearcoat = 1;

        Assert.Equal(Key(before), Key(after));
    }

    [Fact]
    public void PlainMaterial_IgnoresMappingAndMapSize()
    {
        var before = ThreeMaterial.Default();
        var after = ThreeMaterial.Default();
        after.Mapping = UvMapping.World;
        after.MapSize = 1000;

        Assert.Equal(Key(before, "c/{0}/0"), Key(after, "c/{0}/7"));
    }

    [Fact]
    public void GainingUvs_ChangesTheKey()
    {
        var plain = ThreeMaterial.Default();
        var grained = ThreeMaterial.Default();
        grained.Anisotropy = 0.5;

        Assert.NotEqual(Key(plain), Key(grained));
    }

    [Fact]
    public void AnisotropyStrength_KeepsTheKey()
    {
        var before = ThreeMaterial.Default();
        before.Anisotropy = 0.5;
        var after = ThreeMaterial.Default();
        after.Anisotropy = 0.9;
        after.AnisotropyRotation = 1;

        Assert.Equal(Key(before), Key(after));
    }

    [Fact]
    public void Grain_KeysOnMapSizeAndId()
    {
        Assert.NotEqual(Key(Textured(mapSize: 500)), Key(Textured(mapSize: 800)));
        Assert.NotEqual(Key(Textured(), "c/{0}/0"), Key(Textured(), "c/{0}/1"));
    }

    [Theory]
    [InlineData(UvMapping.World)]
    [InlineData(UvMapping.Surface)]
    public void NonGrainMappings_IgnoreMapSizeAndId(UvMapping mapping)
    {
        Assert.Equal(Key(Textured(mapping, 500), "c/{0}/0"), Key(Textured(mapping, 800), "c/{0}/1"));
    }

    [Fact]
    public void AuthoredUvs_AreScaledNotGrained_SoIgnoreMapSizeAndId()
    {
        var a = Key(Textured(UvMapping.Authored, 500), "c/{0}/0", authoredUvs: true);
        var b = Key(Textured(UvMapping.Authored, 800), "c/{0}/1", authoredUvs: true);

        Assert.Equal(a, b);
        Assert.NotEqual(a, Key(Textured(UvMapping.Authored, 500), "c/{0}/0", authoredUvs: false));
    }

    [Fact]
    public void GeometryMeshingAndUnits_ChangeTheKey()
    {
        var material = Textured(UvMapping.World);

        Assert.NotEqual(Key(material), Key(material, crc: 43));
        Assert.NotEqual(Key(material), Key(material, meshing: "smooth"));
        Assert.NotEqual(Key(material), Key(material, mmPerUnit: 1000));
    }
}
