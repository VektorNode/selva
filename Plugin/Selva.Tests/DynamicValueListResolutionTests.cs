using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.Tests;

/// <summary>
///     A wired Get Dynamic Value List resolving its pick in the solve. The cases come from the fixture
///     the browser tests load too, so both show the same pick.
/// </summary>
public class DynamicValueListResolutionTests
{
    private static readonly JObject Fixture = JObject.Parse(File.ReadAllText(Path.Combine(
        FindRepoRoot(), "packages", "schemas", "fixtures", "dynamic-value-list-resolution.json")));

    public static IEnumerable<object[]> SingleCases =>
        Fixture["single"]!.Select(c => new object[] { c.Value<string>("name")! });

    public static IEnumerable<object[]> RowCases =>
        Fixture["rows"]!.Select(c => new object[] { c.Value<string>("name")! });

    [Theory]
    [MemberData(nameof(SingleCases))]
    public void ResolvePick_MatchesSharedFixture(string name)
    {
        var c = Case("single", name);

        var resolved = DynamicValueListLogic.ResolvePick(Items(c["options"]!), c.Value<string>("pick")!);

        Assert.Equal(c.Value<string>("expect"), resolved.Expression);
        Assert.Equal(c.Value<bool>("replaced"), resolved.Replaced);
    }

    [Theory]
    [MemberData(nameof(RowCases))]
    public void ResolveRows_MatchesSharedFixture(string name)
    {
        var c = Case("rows", name);
        var picks = DynamicValueListLogic.ParseRowPicks(c["picks"]!.ToString());
        var options = c["options"]!.Select(set => (IReadOnlyList<(string, string)>)Items(set)).ToList();

        var resolved = DynamicValueListLogic.ResolveRows(c["rows"]!.Values<string>().Select(k => k!).ToList(), picks, options);

        Assert.Equal(c["expect"]!.Values<string>(), resolved.Select(r => r.Expression));
    }

    [Fact]
    public void ResolvePicks_KeepsOfferedPicksAndFallsBackToFirst()
    {
        var options = new List<(string Name, string Expression)> { ("a", "a"), ("b", "b"), ("c", "c") };

        Assert.Equal(new[] { "c", "a" },
            DynamicValueListLogic.ResolvePicks(options, new[] { "c", "x", "a", "c" }).Select(r => r.Expression));
        var none = DynamicValueListLogic.ResolvePicks(options, new[] { "x" });
        Assert.Equal("a", Assert.Single(none).Expression);
        Assert.True(none[0].Replaced);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Knob")]
    [InlineData("[\"Knob\"]")]
    [InlineData("{ not json")]
    public void ParseRowPicks_ReadsAnythingButAPicksObjectAsNoPicks(string? value)
    {
        Assert.Empty(DynamicValueListLogic.ParseRowPicks(value!));
    }

    [Fact]
    public void Payload_ResolvedInSolveRoundTripsAndItemOptionsStayLocal()
    {
        var payload = new DynamicValueListPayload(Guid.NewGuid(), new Dictionary<string, string> { ["a"] = "a" })
        {
            ResolvedInSolve = true,
            ItemOptions = new List<Dictionary<string, string>> { new() { ["a"] = "a" } }
        };

        var json = JObject.Parse(payload.ToComputeJson());

        Assert.True(json.Value<bool>("resolvedInSolve"));
        Assert.Null(json["itemOptions"]);
        Assert.True(DynamicValueListPayload.FromJson(payload.ToComputeJson()).ResolvedInSolve);
        Assert.Equal("a", payload.Clone().ItemOptions![0]["a"]);
        Assert.Null(JObject.Parse(new DynamicValueListPayload().ToComputeJson())["resolvedInSolve"]);
    }

    private static JToken Case(string group, string name)
    {
        return Fixture[group]!.Single(c => c.Value<string>("name") == name);
    }

    private static List<(string Name, string Expression)> Items(JToken options)
    {
        return ((JObject)options).Properties().Select(p => (p.Name, p.Value.ToString())).ToList();
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException(
            "Could not locate repo root (pnpm-workspace.yaml) from " + AppContext.BaseDirectory);
    }
}
