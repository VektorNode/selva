using Newtonsoft.Json;
using Xunit;

namespace Selva.Slva.Tests;

public class ThreeMaterialTests
{
    [Theory]
    [InlineData(UvMapping.Authored, false, null, UvMapping.Authored)]
    [InlineData(UvMapping.Surface, true, 1000.0, UvMapping.Surface)]
    // A texture with no real size was authored against Rhino's mapping.
    [InlineData(UvMapping.Auto, true, null, UvMapping.Surface)]
    [InlineData(UvMapping.Auto, true, 1000.0, UvMapping.Part)]
    [InlineData(UvMapping.Auto, false, null, UvMapping.Part)]
    public void ResolvedMapping(UvMapping mapping, bool hasMap, double? mapSize, UvMapping expected)
    {
        var material = ThreeMaterial.Default();
        material.Mapping = mapping;
        material.Map = hasMap ? "https://example.com/wood.jpg" : null;
        material.MapSize = mapSize;

        Assert.Equal(expected, material.ResolvedMapping);
    }

    [Fact]
    public void Mapping_SurvivesTheGooRoundTrip_AndAutoStaysOff()
    {
        var material = ThreeMaterial.Default();
        material.Mapping = UvMapping.Authored;

        var json = JsonConvert.SerializeObject(material, new ColorJsonConverter());
        var back = JsonConvert.DeserializeObject<ThreeMaterial>(json, new ColorJsonConverter());

        Assert.Equal(UvMapping.Authored, back.Mapping);
        Assert.DoesNotContain("mapping", JsonConvert.SerializeObject(ThreeMaterial.Default(), new ColorJsonConverter()));
    }

    [Fact]
    public void FinishStrength_IsOffTheWireUntilSet_AndZeroNeedsNoUvs()
    {
        var material = ThreeMaterial.Default();
        material.Finish = "brushed";
        Assert.DoesNotContain("finishStrength", JsonConvert.SerializeObject(material, new ColorJsonConverter()));
        Assert.True(material.NeedsUvs);

        material.FinishStrength = 0;
        Assert.Contains("\"finishStrength\":0", JsonConvert.SerializeObject(material, new ColorJsonConverter()));
        Assert.False(material.NeedsUvs);
    }
}
