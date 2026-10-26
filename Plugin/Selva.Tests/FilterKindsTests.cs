using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.Tests;

public class FilterKindsTests
{
    private static readonly (uint Flag, string Kind)[] Kinds = { (0x1, "point"), (0x4, "curve"), (0x8, "surface") };

    [Fact]
    public void AFilter_AllowsTheKindsWhoseFlagsItSets_InTableOrder()
    {
        Assert.Equal(new[] { "point", "surface" }, FilterKinds.Allowed(0x8 | 0x1, Kinds));
    }

    // A fresh Get Geometry allows everything; the page shows no filter for it.
    [Fact]
    public void AFilterThatAllowsEveryKind_IsNoFilter()
    {
        Assert.Empty(FilterKinds.Allowed(0x1 | 0x4 | 0x8, Kinds));
        Assert.Empty(FilterKinds.Allowed(uint.MaxValue, Kinds));
    }

    [Fact]
    public void FlagsOutsideTheTable_AreIgnored()
    {
        Assert.Equal(new[] { "curve" }, FilterKinds.Allowed(0x4 | 0x100, Kinds));
    }
}
