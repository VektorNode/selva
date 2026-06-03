using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

/// <summary>
///     Golden contract for the outbound WebSocket envelopes the web UI reads. Every message that
///     historically drifted from the TS handlers has a row pinning its exact shape. These run with no
///     Grasshopper runtime — they exercise the pure builders the Rhino-typed WebSocketTransport now
///     delegates to. The two cross-stack fixture tests load the SAME json vitest loads on the TS side,
///     so a shape change reddens one stack instead of silently freezing a live canvas.
/// </summary>
public class OutboundEnvelopesTests
{
    private const string Session = "session-1";

    private static JObject Json(object envelope) =>
        JObject.Parse(JsonConvert.SerializeObject(envelope));

    // -------------------------------------------------------------------------
    // The two rules that broke the UI silently (ADR 0002)
    // -------------------------------------------------------------------------

    [Fact]
    public void ParametersAdded_PutsAvailableParamsAtTopLevel_NotUnderData()
    {
        var json = Json(OutboundEnvelopes.ParametersAdded(Session, new DiscoveredParameters()));

        Assert.Equal("parametersAdded", (string)json["type"]);
        Assert.Equal(Session, (string)json["sessionId"]);
        Assert.NotNull(json["availableParams"]);     // flat — the UI reads it here
        Assert.Null(json["data"]);                   // must NOT be wrapped
    }

    [Fact]
    public void Wrapped_PutsPayloadUnderData()
    {
        var json = Json(OutboundEnvelopes.Wrapped(Session, "disconnecting", new { reason = "x" }));

        Assert.Equal("disconnecting", (string)json["type"]);
        Assert.NotNull(json["data"]);
        Assert.Equal("x", (string)json["data"]["reason"]);
    }

    [Fact]
    public void MetadataUpdated_FlattensInputsAndOutputsIntoOneArrayKeyedById()
    {
        var inId = Guid.NewGuid();
        var outId = Guid.NewGuid();
        var changed = new DiscoveredParameters
        {
            Inputs = new List<DiscoveredInput>
            {
                new DiscoveredInput { Id = inId, Nickname = "Count", Minimum = 0, Maximum = 10 }
            },
            Outputs = new List<DiscoveredOutput>
            {
                new DiscoveredOutput { Id = outId, Nickname = "Area" }
            }
        };

        var json = Json(OutboundEnvelopes.MetadataUpdated(Session, changed));

        Assert.Equal("metadataUpdated", (string)json["type"]);
        var arr = (JArray)json["changedParams"];     // FLAT array, not nested {inputs,outputs}
        Assert.Equal(2, arr.Count);
        Assert.Equal(inId.ToString(), (string)arr[0]["id"]);
        Assert.Equal(0, (int)arr[0]["minimum"]);
        Assert.Equal(outId.ToString(), (string)arr[1]["id"]);
    }

    [Fact]
    public void MetadataUpdated_OmitsAbsentOptionalFields_NotNulls()
    {
        // The UI uses `!== undefined` checks — absent fields must be missing keys, not explicit nulls.
        var changed = new DiscoveredParameters
        {
            Inputs = new List<DiscoveredInput>
            {
                new DiscoveredInput { Id = Guid.NewGuid(), Nickname = "Name" } // no min/max/step/options
            },
            Outputs = new List<DiscoveredOutput>()
        };

        var item = (JObject)((JArray)Json(OutboundEnvelopes.MetadataUpdated(Session, changed))["changedParams"])[0];

        Assert.False(item.ContainsKey("minimum"));
        Assert.False(item.ContainsKey("maximum"));
        Assert.False(item.ContainsKey("stepSize"));
        Assert.False(item.ContainsKey("options"));
    }

    [Fact]
    public void MetadataUpdated_ReturnsNull_WhenNothingChanged()
    {
        Assert.Null(OutboundEnvelopes.MetadataUpdated(Session, null));
        Assert.Null(OutboundEnvelopes.MetadataUpdated(Session, new DiscoveredParameters()));
    }

    // -------------------------------------------------------------------------
    // Envelope shapes — one assertion-light row per message
    // -------------------------------------------------------------------------

    [Fact]
    public void Outputs_CarriesBinaryBatchCountAndModelUnits()
    {
        var json = Json(OutboundEnvelopes.Outputs(
            Session,
            new Dictionary<string, object> { ["out-area"] = 9 },
            new Dictionary<string, object>(),
            binaryBatchCount: 2,
            modelUnits: "Meters"));

        Assert.Equal("outputs", (string)json["type"]);
        Assert.Equal(2, (int)json["binaryBatchCount"]);
        Assert.Equal("Meters", (string)json["modelUnits"]);
    }

    [Fact]
    public void SchemaSaved_CarriesSuccessAndMessage()
    {
        var json = Json(OutboundEnvelopes.SchemaSaved(Session, false, "boom"));
        Assert.Equal("schemaSaved", (string)json["type"]);
        Assert.False((bool)json["success"]);
        Assert.Equal("boom", (string)json["message"]);
    }

    [Fact]
    public void SyncApplied_DefaultsMessageBySuccess()
    {
        Assert.Equal("Sync completed successfully",
            (string)Json(OutboundEnvelopes.SyncApplied(Session, true, null))["message"]);
        Assert.Equal("Sync failed",
            (string)Json(OutboundEnvelopes.SyncApplied(Session, false, null))["message"]);
    }

    [Fact]
    public void SchemaSaveRejected_DefaultsReason()
    {
        var json = Json(OutboundEnvelopes.SchemaSaveRejected(Session, new UISchema(), "hash-1", null));
        Assert.Equal("schemaSaveRejected", (string)json["type"]);
        Assert.Equal("hash-1", (string)json["schemaHash"]);
        Assert.False(string.IsNullOrEmpty((string)json["reason"]));
    }

    // -------------------------------------------------------------------------
    // Cross-stack golden fixtures — the SAME json files vitest loads on the TS side.
    // If these and the TS guards stop agreeing, the wire contract has drifted.
    // -------------------------------------------------------------------------

    [Fact]
    public void ParametersAdded_MatchesSharedCrossStackFixture()
    {
        var fixture = LoadFixture("parameters-added.json");
        var produced = Json(OutboundEnvelopes.ParametersAdded(
            (string)fixture["sessionId"],
            fixture["availableParams"].ToObject<DiscoveredParameters>()));

        Assert.Equal((string)fixture["type"], (string)produced["type"]);
        // availableParams must live at the top level in both.
        Assert.NotNull(produced["availableParams"]);
        Assert.NotNull(fixture["availableParams"]);
        Assert.Null(produced["data"]);
    }

    [Fact]
    public void MetadataUpdated_MatchesSharedCrossStackFixture()
    {
        var fixture = LoadFixture("metadata-updated.json");
        var produced = Json(OutboundEnvelopes.MetadataUpdated(
            (string)fixture["sessionId"],
            new DiscoveredParameters
            {
                Inputs = fixture["_source"]["inputs"].ToObject<List<DiscoveredInput>>(),
                Outputs = fixture["_source"]["outputs"].ToObject<List<DiscoveredOutput>>()
            }));

        Assert.Equal((string)fixture["type"], (string)produced["type"]);
        Assert.True(JToken.DeepEquals(fixture["changedParams"], produced["changedParams"]),
            $"changedParams drift:\n fixture={fixture["changedParams"]}\n c#={produced["changedParams"]}");
    }

    private static JObject LoadFixture(string name)
    {
        var path = Path.Combine(FindRepoRoot(), "packages", "schemas", "fixtures", "wire", name);
        return JObject.Parse(File.ReadAllText(path));
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
