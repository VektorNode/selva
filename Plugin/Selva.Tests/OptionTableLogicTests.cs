using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.Tests;

/// <summary>
///     Options By and Repeat: the table and row rules, and the payload both stacks read. No
///     Grasshopper runtime required.
/// </summary>
public class OptionTableLogicTests
{
    private static IReadOnlyList<IReadOnlyList<string>> Branches(params string[][] branches)
    {
        return branches.Select(b => (IReadOnlyList<string>)b.ToList()).ToList();
    }

    [Fact]
    public void BuildTable_PairsBranchWithKeyInOrder()
    {
        var problems = new List<string>();
        var table = OptionTableLogic.BuildTable(
            new[] { "Shaker", "Handleless" },
            Branches(new[] { "Shaker door", "Shaker drawers" }, new[] { "Push door" }),
            problems);

        Assert.Empty(problems);
        Assert.Equal(new[] { "Shaker door", "Shaker drawers" }, table["Shaker"].Keys);
        Assert.Equal("Push door", table["Handleless"]["Push door"]);
    }

    [Fact]
    public void BuildTable_ReadsNamedValues()
    {
        var table = OptionTableLogic.BuildTable(
            new[] { "a" }, Branches(new[] { "\"Light grey\" = #D7D7D7" }), new List<string>());

        Assert.Equal("#D7D7D7", table["a"]["Light grey"]);
    }

    [Fact]
    public void BuildTable_ReportsBranchKeyMismatchAndKeepsWhatPairs()
    {
        var problems = new List<string>();
        var table = OptionTableLogic.BuildTable(
            new[] { "a", "b", "c" }, Branches(new[] { "x" }, new[] { "y" }), problems);

        Assert.Equal(2, table.Count);
        Assert.Contains(problems, p => p.Contains("2 option branch(es) for 3 key(s)"));
    }

    [Fact]
    public void BuildTable_ReportsDuplicateKeysAndOptions()
    {
        var problems = new List<string>();
        OptionTableLogic.BuildTable(
            new[] { "a", "a" }, Branches(new[] { "x", "x" }, new[] { "y" }), problems);

        Assert.Contains(problems, p => p.Contains("Key \"a\" appears twice"));
        Assert.Contains(problems, p => p.Contains("Option \"x\" appears twice"));
    }

    [Fact]
    public void Pick_FallsBackToStar()
    {
        var table = new Dictionary<string, Dictionary<string, string>>
        {
            ["a"] = new() { ["x"] = "x" },
            [OptionTableLogic.FallbackKey] = new() { ["other"] = "other" }
        };

        Assert.Equal(new[] { "x" }, OptionTableLogic.Pick(table, "a").Keys);
        Assert.Equal(new[] { "other" }, OptionTableLogic.Pick(table, "zzz").Keys);
        Assert.Equal(new[] { "other" }, OptionTableLogic.Pick(table, null!).Keys);
    }

    [Fact]
    public void BuildRows_TakesLabelsAndSectionsByIndex()
    {
        var problems = new List<string>();
        var rows = OptionTableLogic.BuildRows(
            new[] { "back/sink", "back/hob" }, new[] { "Sink" }, Array.Empty<string>(), problems);

        Assert.Empty(problems);
        Assert.Equal("Sink", rows[0].Label);
        Assert.Null(rows[1].Label);
        Assert.Null(rows[0].Section);
    }

    [Fact]
    public void BuildRows_DropsEmptyAndDuplicateKeys()
    {
        var problems = new List<string>();
        var rows = OptionTableLogic.BuildRows(
            new[] { "a", " ", "a", "b" }, Array.Empty<string>(), Array.Empty<string>(), problems);

        Assert.Equal(new[] { "a", "b" }, rows.Select(r => r.Key));
        Assert.Equal(2, problems.Count);
    }

    // -------------------------------------------------------------------------
    // Payload: local and compute shapes, round trip, cross-stack fixtures
    // -------------------------------------------------------------------------

    private static DynamicValueListPayload TablePayload()
    {
        return new DynamicValueListPayload(Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-000000000001"),
            new Dictionary<string, string>())
        {
            By = "aaaaaaaa-bbbb-cccc-dddd-000000000002",
            Table = new Dictionary<string, Dictionary<string, string>>
            {
                ["Shaker"] = new() { ["Shaker door"] = "Shaker door" },
                ["*"] = new() { ["Not eligible"] = "Not eligible" }
            }
        };
    }

    private static DynamicValueListPayload RepeatPayload()
    {
        return new DynamicValueListPayload
        {
            Rows = new List<RepeatRow> { new("back/sink", "Sink", "Back wall") },
            Members = new List<string> { "aaaaaaaa-bbbb-cccc-dddd-000000000001" }
        };
    }

    [Fact]
    public void LocalAndComputeShapesMatch_ForTableAndRepeat()
    {
        foreach (var payload in new[] { TablePayload(), RepeatPayload() })
        {
            var computeJson = JObject.Parse(payload.ToComputeJson());
            var localJson = JObject.FromObject(payload.ToCollectorPayload());

            Assert.True(JToken.DeepEquals(computeJson, localJson),
                $"local/compute payload drift:\n compute={computeJson}\n local={localJson}");
        }
    }

    [Fact]
    public void PlainPayload_CarriesNoTableOrRepeatFields()
    {
        var json = JObject.Parse(new DynamicValueListPayload(Guid.Empty,
            new Dictionary<string, string> { ["A"] = "1" }).ToComputeJson());

        Assert.Null(json["by"]);
        Assert.Null(json["table"]);
        Assert.Null(json["rows"]);
        Assert.Null(json["members"]);
    }

    [Fact]
    public void Clone_KeepsTableAndRows()
    {
        var table = TablePayload().Clone();
        var repeat = RepeatPayload().Clone();

        Assert.Equal("Shaker door", table.Table["Shaker"]["Shaker door"]);
        Assert.Equal("aaaaaaaa-bbbb-cccc-dddd-000000000002", table.By);
        Assert.Equal("Back wall", repeat.Rows[0].Section);
        Assert.Equal(Guid.Empty, repeat.TargetInputId);
    }

    [Theory]
    [InlineData("option-table-payload.json")]
    [InlineData("repeat-payload.json")]
    public void SharedFixture_RoundTrips(string fixtureName)
    {
        var fixture = JObject.Parse(File.ReadAllText(Path.Combine(
            FindRepoRoot(), "packages", "schemas", "fixtures", fixtureName)));
        fixture.Remove("_comment");

        var reSerialized = JObject.Parse(DynamicValueListPayload.FromJson(fixture.ToString()).ToComputeJson());

        Assert.True(JToken.DeepEquals(fixture, reSerialized),
            $"fixture drift:\n fixture={fixture}\n c#={reSerialized}");
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
