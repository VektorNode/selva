using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

/// <summary>
///     Golden contract for ContextBake-wired outputs. Every Selva output type has a row here pinning
///     (a) how it is classified and (b) the exact payload the WebSocket collector broadcasts. Adding a
///     new output type without adding a row leaves <see cref="OutputPayloadBuilder" /> branch coverage
///     gaps that these tests are meant to catch.
///
///     These run with no Grasshopper runtime — they exercise the pure decision layer the Rhino-typed
///     ValueCollector now delegates to, which is exactly the layer that kept silently dropping data.
/// </summary>
public class OutputPayloadContractTests
{
    // -------------------------------------------------------------------------
    // Classification — one row per output type
    // -------------------------------------------------------------------------

    public static IEnumerable<object[]> ClassificationRows()
    {
        yield return new object[]
        {
            "dynamicValueList",
            new GooView
            {
                TypeName = "Dynamic Value List",
                DynamicValueList = new DynamicValueListPayload(Guid.NewGuid(),
                    new Dictionary<string, string> { ["A"] = "1" })
            }
        };
        yield return new object[]
        {
            "chart",
            new GooView { TypeName = "Plotly Figure", ChartJson = "{\"data\":[]}" }
        };
        yield return new object[]
        {
            "file",
            new GooView { TypeName = "File Data", FilePayload = new { fileName = "a.txt" } }
        };
    }

    [Theory]
    [MemberData(nameof(ClassificationRows))]
    public void ClassifyType_MapsEachOutputTypeToItsSchemaString(string expectedType, GooView view)
    {
        Assert.Equal(expectedType, OutputPayloadBuilder.ClassifyType(view));
    }

    [Theory]
    [MemberData(nameof(ClassificationRows))]
    public void Build_ProducesNonNullPayloadForEveryKnownType(string expectedType, GooView view)
    {
        Assert.NotNull(OutputPayloadBuilder.Build(view));
        _ = expectedType;
    }

    // -------------------------------------------------------------------------
    // Unrecognized goo — nothing is invented
    // -------------------------------------------------------------------------

    [Fact]
    public void Build_UnknownGoo_ReturnsNull()
    {
        var view = new GooView { TypeName = "Number" };

        Assert.Null(OutputPayloadBuilder.Build(view));
        Assert.Null(OutputPayloadBuilder.ClassifyType(view));
    }

    [Fact]
    public void Build_NullGoo_ReturnsNull()
    {
        Assert.Null(OutputPayloadBuilder.Build(null));
    }

    // -------------------------------------------------------------------------
    // dynamicValueList — exact wire shape, and local/compute agreement
    // -------------------------------------------------------------------------

    [Fact]
    public void DynamicValueList_CollectorPayloadCarriesTargetIdAndOptions()
    {
        var target = Guid.Parse("11111111-2222-3333-4444-555555555555");
        var payload = new DynamicValueListPayload(target,
            new Dictionary<string, string> { ["Sphere"] = "0", ["Box"] = "1" });

        var built = OutputPayloadBuilder.Build(new GooView { DynamicValueList = payload });

        // Round-trip through JSON so the assertion is on the serialized wire shape, not C# identity.
        var json = JObject.FromObject(built);
        Assert.Equal(target.ToString(), (string)json["targetInputId"]);
        Assert.Equal("0", (string)json["options"]["Sphere"]);
        Assert.Equal("1", (string)json["options"]["Box"]);
    }

    [Fact]
    public void DynamicValueList_EmptyTargetSerializesAsNull()
    {
        var payload = new DynamicValueListPayload(Guid.Empty,
            new Dictionary<string, string> { ["A"] = "1" });

        var json = JObject.FromObject(OutputPayloadBuilder.Build(new GooView { DynamicValueList = payload }));

        Assert.True(json["targetInputId"].Type == JTokenType.Null);
    }

    [Fact]
    public void DynamicValueList_LocalCollectorAndComputeJsonAgree()
    {
        // The whole point of the single-payload refactor: the local WebSocket path and the
        // Rhino.Compute path must emit byte-identical shapes. ToComputeJson() is the compute path;
        // ToCollectorPayload() (serialized) is the local path. They must match.
        var payload = new DynamicValueListPayload(
            Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
            new Dictionary<string, string> { ["X"] = "10", ["Y"] = "20" });

        var computeJson = JObject.Parse(payload.ToComputeJson());
        var localJson = JObject.FromObject(payload.ToCollectorPayload());

        Assert.True(JToken.DeepEquals(computeJson, localJson),
            $"local/compute payload drift:\n compute={computeJson}\n local={localJson}");
    }

    [Fact]
    public void DynamicValueList_JsonRoundTripPreservesPayload()
    {
        var original = new DynamicValueListPayload(
            Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
            new Dictionary<string, string> { ["X"] = "10" });

        var restored = DynamicValueListPayload.FromJson(original.ToComputeJson());

        Assert.Equal(original.TargetInputId, restored.TargetInputId);
        Assert.Equal(original.Options["X"], restored.Options["X"]);
    }

    // -------------------------------------------------------------------------
    // chart / file — payload is passed through verbatim
    // -------------------------------------------------------------------------

    [Fact]
    public void Chart_PayloadIsTheRawJsonString()
    {
        var view = new GooView { TypeName = "Plotly Figure", ChartJson = "{\"data\":[1,2,3]}" };

        Assert.Equal("{\"data\":[1,2,3]}", OutputPayloadBuilder.Build(view));
    }

    [Fact]
    public void File_PayloadIsPassedThrough()
    {
        var file = new { fileName = "report.pdf" };
        var view = new GooView { TypeName = "File Data", FilePayload = file };

        Assert.Same(file, OutputPayloadBuilder.Build(view));
    }

    // -------------------------------------------------------------------------
    // Classify — the three named outcomes that replace the adapter's silent null
    // -------------------------------------------------------------------------

    [Fact]
    public void Classify_NoGoos_IsEmpty()
    {
        Assert.Equal(BuildOutcomeKind.Empty, OutputPayloadBuilder.Classify(new GooView[0]).Kind);
        Assert.Equal(BuildOutcomeKind.Empty, OutputPayloadBuilder.Classify(null).Kind);
    }

    [Fact]
    public void Classify_AllNullEntries_IsEmpty()
    {
        var outcome = OutputPayloadBuilder.Classify(new GooView[] { null, null });

        Assert.Equal(BuildOutcomeKind.Empty, outcome.Kind);
    }

    [Fact]
    public void Classify_GooPresentButNoSelvaType_IsUnknownAndKeepsTypeName()
    {
        // The exact live-bug signature: a goo IS on the bake input, but it's not a Selva output
        // (unwrap miss, or an upstream TypeName rename). The outcome names the culprit.
        var outcome = OutputPayloadBuilder.Classify(new[]
        {
            new GooView { TypeName = "Number" }
        });

        Assert.Equal(BuildOutcomeKind.UnknownType, outcome.Kind);
        Assert.Equal("Number", outcome.ObservedTypeName);
        Assert.Null(outcome.Payload);
    }

    [Fact]
    public void Classify_FirstRecognizedGooWins_OverLeadingUnknowns()
    {
        var target = Guid.NewGuid();
        var outcome = OutputPayloadBuilder.Classify(new[]
        {
            new GooView { TypeName = "Number" }, // unknown, skipped
            new GooView
            {
                TypeName = "Dynamic Value List",
                DynamicValueList = new DynamicValueListPayload(target,
                    new Dictionary<string, string> { ["A"] = "1" })
            }
        });

        Assert.Equal(BuildOutcomeKind.Matched, outcome.Kind);
        Assert.Equal("dynamicValueList", outcome.OutputType);
        Assert.Equal("Dynamic Value List", outcome.ObservedTypeName);
        Assert.NotNull(outcome.Payload);
    }

    // -------------------------------------------------------------------------
    // Cross-stack golden fixture — the SAME json file vitest loads on the TS side.
    // If this and the TS test stop agreeing, the wire contract has drifted.
    // -------------------------------------------------------------------------

    [Fact]
    public void DynamicValueList_RoundTripsTheSharedCrossStackFixture()
    {
        var fixturePath = Path.Combine(
            FindRepoRoot(), "packages", "schemas", "fixtures", "dynamic-value-list-payload.json");
        var fixture = JObject.Parse(File.ReadAllText(fixturePath));

        // Parse the fixture as the C# payload, re-serialize, and assert the meaningful fields survive
        // byte-identical — i.e. the C# type understands exactly the shape the TS side ships.
        var payload = DynamicValueListPayload.FromJson(fixture.ToString());
        var reSerialized = JObject.Parse(payload.ToComputeJson());

        Assert.Equal((string)fixture["targetInputId"], (string)reSerialized["targetInputId"]);
        Assert.True(JToken.DeepEquals(fixture["options"], reSerialized["options"]),
            $"options drift: fixture={fixture["options"]} c#={reSerialized["options"]}");
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

    [Fact]
    public void Classify_ToString_IsHumanReadablePerOutcome()
    {
        // The string is what lands in Rhino's log; pin it so the live signal stays legible.
        Assert.Equal("Empty", OutputPayloadBuilder.Classify(new GooView[0]).ToString());

        Assert.Equal("UnknownType('Number')",
            OutputPayloadBuilder.Classify(new[] { new GooView { TypeName = "Number" } }).ToString());

        var matched = OutputPayloadBuilder.Classify(new[]
        {
            new GooView { TypeName = "File Data", FilePayload = new { f = 1 } }
        });
        Assert.Equal("Matched(file, 'File Data')", matched.ToString());
    }
}
