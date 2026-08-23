using System.Collections.Generic;
using Selva.GH.Features.ComputeIO.Components;

namespace Selva.Tests;

/// <summary>
///     Tests for DynamicValueListLogic — the pure selection/matching logic extracted from
///     GetDynamicValueListParameter. No Rhino/GH runtime required.
/// </summary>
public class DynamicValueListLogicTests
{
    private static List<(string Name, string Expression)> Items(params (string, string)[] pairs)
    {
        return new List<(string Name, string Expression)>(pairs);
    }

    // -------------------------------------------------------------------------
    // FindMatchingIndex
    // -------------------------------------------------------------------------

    [Fact]
    public void FindMatchingIndex_MatchesByName()
    {
        var items = Items(("Sphere", "0"), ("Box", "1"));

        Assert.Equal(1, DynamicValueListLogic.FindMatchingIndex(items, "Box"));
    }

    [Fact]
    public void FindMatchingIndex_MatchesByExpression()
    {
        var items = Items(("Sphere", "0"), ("Box", "1"));

        Assert.Equal(0, DynamicValueListLogic.FindMatchingIndex(items, "0"));
    }

    [Fact]
    public void FindMatchingIndex_IsCaseInsensitive()
    {
        var items = Items(("Sphere", "expr"));

        Assert.Equal(0, DynamicValueListLogic.FindMatchingIndex(items, "SPHERE"));
        Assert.Equal(0, DynamicValueListLogic.FindMatchingIndex(items, "EXPR"));
    }

    [Fact]
    public void FindMatchingIndex_NoMatch_ReturnsMinusOne()
    {
        var items = Items(("Sphere", "0"));

        Assert.Equal(-1, DynamicValueListLogic.FindMatchingIndex(items, "Cone"));
    }

    [Fact]
    public void FindMatchingIndex_NullItems_ReturnsMinusOne()
    {
        Assert.Equal(-1, DynamicValueListLogic.FindMatchingIndex(null, "x"));
    }

    [Fact]
    public void FindMatchingIndex_NameTakesPrecedenceOverLaterExpressionMatch()
    {
        // "1" is Box's name and Cone's expression; the earlier name match wins.
        var items = Items(("0", "a"), ("1", "b"), ("Cone", "1"));

        Assert.Equal(1, DynamicValueListLogic.FindMatchingIndex(items, "1"));
    }

    // -------------------------------------------------------------------------
    // ResolveExpression
    // -------------------------------------------------------------------------

    [Fact]
    public void ResolveExpression_MatchedByName_ReturnsExpression()
    {
        var items = Items(("Sphere", "0"), ("Box", "1"));

        var (expression, index) = DynamicValueListLogic.ResolveExpression(items, "Box");

        Assert.Equal("1", expression);
        Assert.Equal(1, index);
    }

    [Fact]
    public void ResolveExpression_NoMatch_PassesValueThroughVerbatim()
    {
        var items = Items(("Sphere", "0"));

        var (expression, index) = DynamicValueListLogic.ResolveExpression(items, "custom");

        Assert.Equal("custom", expression);
        Assert.Equal(-1, index);
    }

    // -------------------------------------------------------------------------
    // GetDefaultValue — precedence: selection > first option > empty
    // -------------------------------------------------------------------------

    [Fact]
    public void GetDefaultValue_SelectionWins()
    {
        var items = Items(("Sphere", "0"));
        var selected = new List<string> { "chosen" };

        Assert.Equal("chosen", DynamicValueListLogic.GetDefaultValue(selected, items));
    }

    [Fact]
    public void GetDefaultValue_NoSelection_FallsBackToFirstItemExpression()
    {
        var items = Items(("Sphere", "0"), ("Box", "1"));

        Assert.Equal("0", DynamicValueListLogic.GetDefaultValue(null, items));
    }

    [Fact]
    public void GetDefaultValue_EmptySelection_FallsBackToFirstItem()
    {
        var items = Items(("Sphere", "0"));

        Assert.Equal("0", DynamicValueListLogic.GetDefaultValue(new List<string>(), items));
    }

    [Fact]
    public void GetDefaultValue_NoSelectionNoItems_ReturnsEmpty()
    {
        Assert.Equal("", DynamicValueListLogic.GetDefaultValue(null, null));
        Assert.Equal("", DynamicValueListLogic.GetDefaultValue(new List<string>(), Items()));
    }

    // -------------------------------------------------------------------------
    // FilterSelectableValues
    // -------------------------------------------------------------------------

    [Fact]
    public void FilterSelectableValues_DropsNullAndEmpty_PreservesOrder()
    {
        var result = DynamicValueListLogic.FilterSelectableValues(new[] { "a", "", null, "b" });

        Assert.Equal(new[] { "a", "b" }, result);
    }

    [Fact]
    public void FilterSelectableValues_NullInput_ReturnsEmpty()
    {
        Assert.Empty(DynamicValueListLogic.FilterSelectableValues(null));
    }

    [Fact]
    public void FilterSelectableValues_AllBlank_ReturnsEmpty()
    {
        Assert.Empty(DynamicValueListLogic.FilterSelectableValues(new[] { "", null }));
    }

    // -------------------------------------------------------------------------
    // ToValuesDictionary
    // -------------------------------------------------------------------------

    [Fact]
    public void ToValuesDictionary_MapsNameToExpression()
    {
        var items = Items(("Sphere", "0"), ("Box", "1"));

        var dict = DynamicValueListLogic.ToValuesDictionary(items);

        Assert.Equal(2, dict.Count);
        Assert.Equal("0", dict["Sphere"]);
        Assert.Equal("1", dict["Box"]);
    }

    [Fact]
    public void ToValuesDictionary_DuplicateNames_LastWins()
    {
        var items = Items(("dup", "first"), ("dup", "second"));

        var dict = DynamicValueListLogic.ToValuesDictionary(items);

        Assert.Single(dict);
        Assert.Equal("second", dict["dup"]);
    }

    [Fact]
    public void ToValuesDictionary_NullItems_ReturnsEmpty()
    {
        Assert.Empty(DynamicValueListLogic.ToValuesDictionary(null));
    }

    // -------------------------------------------------------------------------
    // ResolveAtMost — list/item access toggle
    // -------------------------------------------------------------------------

    [Fact]
    public void ResolveAtMost_ListAccess_WidensUnsetBoundToUnbounded()
    {
        Assert.Equal(int.MaxValue, DynamicValueListLogic.ResolveAtMost(true, 1));
        Assert.Equal(int.MaxValue, DynamicValueListLogic.ResolveAtMost(true, 0));
    }

    [Fact]
    public void ResolveAtMost_ItemAccess_CollapsesUnboundedToOne()
    {
        Assert.Equal(1, DynamicValueListLogic.ResolveAtMost(false, int.MaxValue));
    }

    [Fact]
    public void ResolveAtMost_ExplicitFiniteBound_LeftUntouched()
    {
        Assert.Equal(5, DynamicValueListLogic.ResolveAtMost(true, 5));
        Assert.Equal(5, DynamicValueListLogic.ResolveAtMost(false, 5));
    }
}
