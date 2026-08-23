using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.ComputeIO.Components;

namespace Selva.Tests;

/// <summary>
///     Tests for OptionPairParser — the shared "key" = value parser used by the Dynamic Value List
///     input (initial options) and output (computed options). Pure string logic, no Rhino/GH runtime.
/// </summary>
public class OptionPairParserTests
{
    private static List<KeyValuePair<string, string>> Parse(params string[] lines)
    {
        return OptionPairParser.Parse(lines).ToList();
    }

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    [Fact]
    public void Parse_SimplePair_SplitsOnFirstEquals()
    {
        var result = Parse("x = 0");

        Assert.Single(result);
        Assert.Equal("x", result[0].Key);
        Assert.Equal("0", result[0].Value);
    }

    [Fact]
    public void Parse_PreservesOrder()
    {
        var result = Parse("a = 1", "b = 2", "c = 3");

        Assert.Equal(new[] { "a", "b", "c" }, result.Select(r => r.Key));
        Assert.Equal(new[] { "1", "2", "3" }, result.Select(r => r.Value));
    }

    [Fact]
    public void Parse_TrimsWhitespaceAroundKeyAndValue()
    {
        var result = Parse("   name   =   value   ");

        Assert.Equal("name", result[0].Key);
        Assert.Equal("value", result[0].Value);
    }

    // -------------------------------------------------------------------------
    // Quote stripping
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("\"my key\" = v", "my key")]
    [InlineData("'my key' = v", "my key")]
    public void Parse_StripsSinglePairOfSurroundingQuotesFromKey(string input, string expectedKey)
    {
        var result = Parse(input);

        Assert.Equal(expectedKey, result[0].Key);
        Assert.Equal("v", result[0].Value);
    }

    [Fact]
    public void Parse_DoesNotStripQuotesFromValue()
    {
        var result = Parse("k = \"quoted value\"");

        Assert.Equal("\"quoted value\"", result[0].Value);
    }

    [Fact]
    public void Parse_StripsOnlyOneQuotePair()
    {
        var result = Parse("\"\"double\"\" = v");

        Assert.Equal("\"double\"", result[0].Key);
    }

    [Fact]
    public void Parse_MismatchedQuotes_NotStripped()
    {
        var result = Parse("\"unbalanced = v");

        Assert.Equal("\"unbalanced", result[0].Key);
    }

    // -------------------------------------------------------------------------
    // Value content edge cases
    // -------------------------------------------------------------------------

    [Fact]
    public void Parse_ValueContainingEquals_KeepsEverythingAfterFirstEquals()
    {
        var result = Parse("expr = a = b = c");

        Assert.Equal("expr", result[0].Key);
        Assert.Equal("a = b = c", result[0].Value);
    }

    [Fact]
    public void Parse_EmptyValue_Allowed()
    {
        var result = Parse("k =");

        Assert.Single(result);
        Assert.Equal("k", result[0].Key);
        Assert.Equal("", result[0].Value);
    }

    // -------------------------------------------------------------------------
    // Skip rules
    // -------------------------------------------------------------------------

    [Fact]
    public void Parse_LineWithoutEquals_Skipped()
    {
        var result = Parse("no equals here");

        Assert.Empty(result);
    }

    [Fact]
    public void Parse_EmptyKey_Skipped()
    {
        var result = Parse("  = value");

        Assert.Empty(result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Parse_BlankOrNullLines_Skipped(string? line)
    {
        var result = Parse(line);

        Assert.Empty(result);
    }

    [Fact]
    public void Parse_NullInput_ReturnsEmpty()
    {
        var result = OptionPairParser.Parse(null).ToList();

        Assert.Empty(result);
    }

    [Fact]
    public void Parse_MixedValidAndInvalid_KeepsOnlyValid()
    {
        var result = Parse(
            "good = 1",
            "skip me",
            "",
            "= no key",
            "also good = 2");

        Assert.Equal(new[] { "good", "also good" }, result.Select(r => r.Key));
    }
}
