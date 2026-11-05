using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

public class PickSummaryTests
{
    private static readonly (string, string) Curve = ("curve", "curves");
    private static readonly (string, string) Point = ("point", "points");

    [Fact]
    public void OneItem_IsNamedInTheSingular()
    {
        Assert.Equal("1 point", PickSummary.Of([Point]));
    }

    [Fact]
    public void ItemsOfOneKind_AreCountedInThePlural()
    {
        Assert.Equal("2 curves", PickSummary.Of([Curve, Curve]));
    }

    [Fact]
    public void MixedKinds_AreObjects()
    {
        Assert.Equal("3 objects", PickSummary.Of([Curve, Point, Curve]));
    }
}
