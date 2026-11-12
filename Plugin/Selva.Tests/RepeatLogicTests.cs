using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.Tests;

/// <summary>
///     Repeat: the row rules, and the payload both stacks read. No Grasshopper runtime required.
/// </summary>
public class RepeatLogicTests
{
    [Fact]
    public void BuildRows_TakesLabelsAndSectionsByIndex()
    {
        var problems = new List<string>();
        var rows = RepeatLogic.BuildRows(
            new[] { "back/sink", "back/hob" }, new[] { "Sink" }, Array.Empty<string>(), problems);

        Assert.Empty(problems);
        Assert.Equal("Sink", rows[0].Label);
        Assert.Null(rows[1].Label);
        Assert.Null(rows[0].Section);
    }

    [Fact]
    public void BuildOptions_TakesPlainNamesAndPairs()
    {
        var options = RepeatLogic.BuildOptions(new[] { "Margherita", " ", "\"Extra cheese\" = cheese-2" });

        Assert.Equal(new[] { "Margherita", "Extra cheese" }, options.Keys);
        Assert.Equal("Margherita", options["Margherita"]);
        Assert.Equal("cheese-2", options["Extra cheese"]);
    }

    [Fact]
    public void BuildRows_DropsEmptyAndDuplicateKeys()
    {
        var problems = new List<string>();
        var rows = RepeatLogic.BuildRows(
            new[] { "a", " ", "a", "b" }, Array.Empty<string>(), Array.Empty<string>(), problems);

        Assert.Equal(new[] { "a", "b" }, rows.Select(r => r.Key));
        Assert.Equal(2, problems.Count);
    }

    // -------------------------------------------------------------------------
    // Payload: local and compute shapes, round trip, cross-stack fixture
    // -------------------------------------------------------------------------

    private static DynamicValueListPayload RepeatPayload()
    {
        return new DynamicValueListPayload
        {
            Rows = new List<RepeatRow> { new("back/sink", "Sink", "Back wall") },
            Members = new List<string> { "aaaaaaaa-bbbb-cccc-dddd-000000000001" }
        };
    }

    [Fact]
    public void LocalAndComputeShapesMatch()
    {
        var payload = RepeatPayload();
        var computeJson = JObject.Parse(payload.ToComputeJson());
        var localJson = JObject.FromObject(payload.ToCollectorPayload());

        Assert.True(JToken.DeepEquals(computeJson, localJson),
            $"local/compute payload drift:\n compute={computeJson}\n local={localJson}");
    }

    [Fact]
    public void PlainPayload_CarriesNoRepeatFields()
    {
        var json = JObject.Parse(new DynamicValueListPayload(Guid.Empty,
            new Dictionary<string, string> { ["A"] = "1" }).ToComputeJson());

        Assert.Null(json["rows"]);
        Assert.Null(json["members"]);
    }

    [Fact]
    public void Clone_KeepsRows()
    {
        var repeat = RepeatPayload().Clone();

        Assert.Equal("Back wall", repeat.Rows[0].Section);
        Assert.Equal(Guid.Empty, repeat.TargetInputId);
    }

    [Fact]
    public void SharedFixture_RoundTrips()
    {
        var fixture = JObject.Parse(File.ReadAllText(Path.Combine(
            FindRepoRoot(), "packages", "schemas", "fixtures", "repeat-payload.json")));
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
