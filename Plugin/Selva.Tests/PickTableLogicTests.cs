using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.Tests;

/// <summary>
///     Options Table: reading the table and narrowing it pick by pick. The cases come from the fixture
///     the browser tests load too, so the form offers what the solve offered.
/// </summary>
public class PickTableLogicTests
{
    private static readonly JObject Fixture = JObject.Parse(File.ReadAllText(Path.Combine(
        FindRepoRoot(), "packages", "schemas", "fixtures", "pick-table.json")));

    public static IEnumerable<object[]> Cases =>
        Fixture["cases"]!.Select(c => new object[] { c.Value<string>("name")! });

    [Fact]
    public void ParseAndProject_MatchTheSharedFixture()
    {
        var problems = new List<string>();
        var table = PickTableLogic.Parse(Fixture["table"]!.Values<string>()!, problems);
        var columns = PickTableLogic.AssignColumns(table.Columns, Fixture["inputs"]!.Values<string>().ToList()!);

        Assert.Empty(problems);
        Assert.Equal(new[] { 0, 1, 2 }, columns);
        Assert.Equal(Rows(), PickTableLogic.Project(table, columns));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Narrowing_MatchesTheSharedFixture(string name)
    {
        var c = Fixture["cases"]!.Single(x => x.Value<string>("name") == name);
        var picks = c["picks"]!.Select(Text).ToList();
        var before = new List<List<List<string>>> { Rows() };

        for (var position = 0; position < picks.Count; position++)
        {
            var column = PickTableLogic.Step(before, position, new[] { picks[position] });
            before = column.After;

            Assert.Equal(c["options"]![position]!.Values<string>(), column.Options[0].Select(o => o.Name));
            Assert.Equal(c["shown"]![position]!.Value<string>(), column.Picks[0].Expression);
        }
    }

    [Fact]
    public void Narrowing_PerRowOfARepeat_MatchesTheSharedFixture()
    {
        var c = Fixture["repeated"]!;
        var before = new List<List<List<string>>> { Rows() };

        for (var position = 0; position < c["picks"]!.Count(); position++)
        {
            var column = PickTableLogic.Step(before, position, c["picks"]![position]!.Select(Text).ToList());
            before = column.After;

            Assert.Equal(c["options"]![position]!.Select(row => row.Values<string>()),
                column.Options.Select(row => row.Select(o => o.Name)));
            Assert.Equal(c["shown"]![position]!.Values<string>(), column.Picks.Select(p => p.Expression));
        }
    }

    [Theory]
    [InlineData("driven")]
    [InlineData("branching")]
    public void Narrowing_ByOtherInputsAndAlongBranches_MatchesTheSharedFixture(string name)
    {
        var c = Fixture[name]!;
        var held = (c["held"] ?? new JArray()).Select(v => (IReadOnlyList<string>)new[] { v.Value<string>()! }).ToList();
        var parents = c["parents"]!.Values<int>().ToList();
        var start = PickTableLogic.StartSets(Rows(), held);
        var left = new List<List<List<List<string>>>>();

        for (var index = 0; index < parents.Count; index++)
        {
            var before = parents[index] < 0 ? start : left[parents[index]];
            var column = PickTableLogic.Step(before, held.Count + index, new[] { Text(c["picks"]![index]!) });
            left.Add(column.After);

            Assert.Equal(c["options"]![index]!.Values<string>(), column.Options[0].Select(o => o.Name));
            Assert.Equal(c["shown"]![index]!.Value<string>(), column.Picks[0].Expression);
        }
    }

    [Fact]
    public void StartSets_GiveOneSetPerItemAByInputHolds_AndNarrowNothingWithoutAValue()
    {
        var perItem = PickTableLogic.StartSets(Rows(), new[] { (IReadOnlyList<string>)new[] { "Shaker", "Handleless" } });
        var noValue = PickTableLogic.StartSets(Rows(), new[] { (IReadOnlyList<string>)Array.Empty<string>() });

        Assert.Equal(new[] { 3, 1 }, perItem.Select(set => set.Count));
        Assert.Equal(Rows().Count, Assert.Single(noValue).Count);
    }

    [Fact]
    public void Step_WithNoRowsShowsNothingAndLeavesTheRowsForTheNextInput()
    {
        var before = new List<List<List<string>>> { Rows() };

        var column = PickTableLogic.Step(before, 0, Array.Empty<string>());

        Assert.Empty(column.Picks);
        Assert.Same(before[0], Assert.Single(column.After));
    }

    private static string? Text(JToken token)
    {
        return token.Type == JTokenType.Null ? null : token.Value<string>();
    }

    [Fact]
    public void Parse_ReadsOneMultilineItemLikeOneItemPerLine()
    {
        var perLine = PickTableLogic.Parse(new[] { "A;B", "1;2", "3;4" }, new List<string>());
        var multiline = PickTableLogic.Parse(new[] { "A;B\r\n1;2\n\n3;4\n" }, new List<string>());

        Assert.Equal(perLine.Columns, multiline.Columns);
        Assert.Equal(perLine.Rows, multiline.Rows);
    }

    [Theory]
    [InlineData("Style\tFront, flat", "Style", "Front, flat")]
    [InlineData("Style; Front, flat", "Style", "Front, flat")]
    [InlineData("\"Style\", \"Front\"", "Style", "Front")]
    public void Parse_TakesTheDelimiterFromTheHeader(string header, string first, string second)
    {
        var table = PickTableLogic.Parse(new[] { header }, new List<string>());

        Assert.Equal(new[] { first, second }, table.Columns);
    }

    [Fact]
    public void Parse_ReportsRaggedRowsAndNeverOffersAnEmptyCell()
    {
        var problems = new List<string>();
        var table = PickTableLogic.Parse(new[] { "A,B", "1", "2,x,extra" }, problems);

        Assert.Single(problems);
        Assert.Equal(new[] { "x" }, PickTableLogic.Options(table.Rows, 1).Select(o => o.Name));
    }

    [Fact]
    public void AssignColumns_PrefersTheColumnNamedLikeTheInput_ThenTheLeftmostFreeOne()
    {
        var columns = new[] { "Style", "Front", "Handle" };

        Assert.Equal(new[] { 2, 0, 1 }, PickTableLogic.AssignColumns(columns, new[] { "handle", "A", "B" }));
        Assert.Equal(new[] { 0, 1, 2, -1 }, PickTableLogic.AssignColumns(columns, new[] { "A", "B", "C", "D" }));
    }

    [Fact]
    public void Payload_PickTableRoundTrips()
    {
        var payload = new DynamicValueListPayload
        {
            ResolvedInSolve = true,
            PickTable = new PickTable
            {
                By = new List<string> { "d" },
                Inputs = new List<string> { "a", "b" },
                Parents = new List<int> { -1, 0 },
                Start = new List<List<List<string>>> { Rows() },
                Rows = Rows().Select(row => row.Take(2).ToList()).ToList()
            }
        };

        var json = JObject.Parse(payload.ToComputeJson());
        var back = DynamicValueListPayload.FromJson(payload.ToComputeJson());

        // Start is what the By inputs leave in this solve: Grasshopper-side only.
        Assert.Equal(new[] { "inputs", "parents", "rows", "by" },
            ((JObject)json["pickTable"]!).Properties().Select(p => p.Name));
        Assert.Equal(payload.PickTable.By, back.PickTable!.By);
        Assert.Equal(payload.PickTable.Parents, back.PickTable.Parents);
        Assert.Equal(payload.PickTable.Inputs, back.PickTable!.Inputs);
        Assert.Equal(payload.PickTable.Rows, back.PickTable.Rows);
        Assert.Equal(json["pickTable"]!.ToString(),
            JObject.FromObject(payload.ToCollectorPayload())["pickTable"]!.ToString());
        Assert.Equal(payload.PickTable.Rows, payload.Clone().PickTable!.Rows);
        Assert.Null(JObject.Parse(new DynamicValueListPayload().ToComputeJson())["pickTable"]);
    }

    private static List<List<string>> Rows()
    {
        return Fixture["rows"]!.Select(row => row.Values<string>().Select(cell => cell!).ToList()).ToList();
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
