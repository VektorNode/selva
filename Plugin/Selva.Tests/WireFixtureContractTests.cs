using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Services.Communication;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.Tests;

/// <summary>
///     Cross-stack wire contract: one committed fixture per outbound envelope, serialized the way
///     WebSocketTransport serializes, and validated on the TS side by the Zod guards
///     (packages/plugin-ui/src/lib/websocket/__tests__/wire-fixtures.test.ts reads the SAME files).
///     A C# shape change reddens this test until the fixture is regenerated; a regenerated fixture
///     the TS guard rejects reddens vitest. Either way drift fails CI, not a live canvas.
///
///     The completeness test walks OutboundEnvelopes by reflection, so adding an envelope factory
///     without a fixture sample fails here — coverage cannot silently lag the surface.
///
///     Regenerate after an intentional shape change:
///         UPDATE_WIRE_FIXTURES=1 dotnet test --filter WireFixtureContractTests
/// </summary>
public class WireFixtureContractTests
{
    private const string Session = "session-fixture";

    // Fixed identities and timestamps: fixtures must be byte-stable across runs.
    private static readonly Guid ParamA = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid ParamB = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid RemovedId = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private static readonly DateTime FixedTime = new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc);

    // Mirrors WebSocketTransport's SecureSerializerSettings (sans MaxDepth, which
    // only constrains deserialization) so fixtures match production bytes.
    private static readonly JsonSerializerSettings TransportSettings = new JsonSerializerSettings
    {
        TypeNameHandling = TypeNameHandling.None,
        MetadataPropertyHandling = MetadataPropertyHandling.Ignore
    };

    private static UISchema SampleSchema()
    {
        return new UISchema
        {
            Id = "schema-1",
            Name = "Sample Schema",
            SchemaVersion = "2.0.0",
            Created = FixedTime,
            LastModified = FixedTime
        };
    }

    private static DiscoveredParameters SampleParams()
    {
        return new DiscoveredParameters
        {
            SessionId = Session,
            Timestamp = FixedTime,
            Inputs = new List<DiscoveredInput>
            {
                new DiscoveredInput
                {
                    Id = ParamA,
                    Name = "Count",
                    Nickname = "Count",
                    Description = "How many",
                    Type = "number",
                    Minimum = 0,
                    Maximum = 10,
                    StepSize = 1
                }
            },
            Outputs = new List<DiscoveredOutput>
            {
                new DiscoveredOutput
                {
                    Id = ParamB,
                    Nickname = "Area",
                    Description = "Computed area",
                    Type = "number"
                }
            }
        };
    }

    /// <summary>
    ///     One deterministic sample per OutboundEnvelopes factory (except the generic Wrapped).
    ///     Keyed by fixture file name; MethodName ties the entry to the factory for the
    ///     reflection completeness check.
    /// </summary>
    private static Dictionary<string, (string MethodName, object Envelope)> Samples()
    {
        return new Dictionary<string, (string, object)>
        {
            ["parameters-added.json"] = ("ParametersAdded",
                OutboundEnvelopes.ParametersAdded(Session, SampleParams())),

            ["metadata-updated.json"] = ("MetadataUpdated",
                OutboundEnvelopes.MetadataUpdated(Session, SampleParams())),

            ["current-values.json"] = ("CurrentValues",
                OutboundEnvelopes.CurrentValues(Session, new Dictionary<string, object>
                {
                    [ParamA.ToString()] = 5
                })),

            ["schema-updated.json"] = ("SchemaUpdated",
                OutboundEnvelopes.SchemaUpdated(Session, SampleSchema(), "hash-1",
                    new List<Guid> { RemovedId })),

            ["initial-data.json"] = ("InitialData",
                OutboundEnvelopes.InitialData(Session, SampleSchema(), "hash-1", SampleParams(),
                    new Dictionary<string, object> { [ParamA.ToString()] = 5 }, isSolving: false)),

            ["schema-saved.json"] = ("SchemaSaved",
                OutboundEnvelopes.SchemaSaved(Session, true, "Saved")),

            ["schema-save-rejected.json"] = ("SchemaSaveRejected",
                OutboundEnvelopes.SchemaSaveRejected(Session, SampleSchema(), "hash-1", null)),

            ["solving-state.json"] = ("SolvingState",
                OutboundEnvelopes.SolvingState(Session, true)),

            ["runtime-message.json"] = ("RuntimeMessage",
                OutboundEnvelopes.RuntimeMessage(Session, "warning", "Something happened", FixedTime)),

            ["sync-preview.json"] = ("SyncPreview",
                OutboundEnvelopes.SyncPreview(Session, new SyncDiff
                {
                    FromGH = new List<SyncChange>
                    {
                        new SyncChange
                        {
                            ParamId = ParamA.ToString(),
                            ParamNickname = "Count",
                            Field = "nickname",
                            SchemaValue = "Old",
                            GHValue = "Count",
                            Direction = SyncDirection.FromGH
                        }
                    },
                    ToGH = new List<SyncChange>
                    {
                        new SyncChange
                        {
                            ParamId = ParamB.ToString(),
                            ParamNickname = "Area",
                            Field = "description",
                            SchemaValue = "Computed area",
                            GHValue = "",
                            Direction = SyncDirection.ToGH
                        }
                    }
                })),

            ["sync-applied.json"] = ("SyncApplied",
                OutboundEnvelopes.SyncApplied(Session, true, null)),

            ["outputs.json"] = ("Outputs",
                OutboundEnvelopes.Outputs(
                    Session,
                    new Dictionary<string, object> { [ParamB.ToString()] = 9.5 },
                    new Dictionary<string, object>(),
                    binaryBatchCount: 2,
                    modelUnits: "Meters"))
        };
    }

    [Fact]
    public void EnvelopeFactories_EachHasAFixtureSample()
    {
        var factories = typeof(OutboundEnvelopes)
            .GetMethods(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .Select(m => m.Name)
            .Where(n => n != "Wrapped") // generic envelope, no fixed type
            .Distinct()
            .OrderBy(n => n)
            .ToList();

        var sampled = Samples().Values.Select(s => s.Item1).Distinct().OrderBy(n => n).ToList();

        Assert.True(factories.SequenceEqual(sampled),
            "OutboundEnvelopes factories and fixture samples diverged.\n" +
            $"  factories: {string.Join(", ", factories)}\n" +
            $"  sampled:   {string.Join(", ", sampled)}\n" +
            "Add a sample (and fixture) for every new envelope factory.");
    }

    [Fact]
    public void Fixtures_MatchTheSerializedEnvelopes()
    {
        var fixturesDir = Path.Combine(FindRepoRoot(), "packages", "schemas", "fixtures", "wire");
        var update = Environment.GetEnvironmentVariable("UPDATE_WIRE_FIXTURES") == "1";
        var failures = new List<string>();

        foreach (var (fileName, (_, envelope)) in Samples())
        {
            var produced = JToken.Parse(JsonConvert.SerializeObject(envelope, TransportSettings));
            var path = Path.Combine(fixturesDir, fileName);

            if (update)
            {
                File.WriteAllText(path, produced.ToString(Formatting.Indented) + "\n");
                continue;
            }

            if (!File.Exists(path))
            {
                failures.Add($"{fileName}: missing — run UPDATE_WIRE_FIXTURES=1 dotnet test");
                continue;
            }

            var committed = JToken.Parse(File.ReadAllText(path));
            if (!JToken.DeepEquals(committed, produced))
            {
                failures.Add(
                    $"{fileName}: C# envelope drifted from the committed fixture.\n" +
                    $"  committed: {committed.ToString(Formatting.None)}\n" +
                    $"  produced:  {produced.ToString(Formatting.None)}\n" +
                    "  If the change is intentional, regenerate (UPDATE_WIRE_FIXTURES=1) and make sure " +
                    "the TS wire-fixtures test still passes.");
            }
        }

        Assert.True(failures.Count == 0, string.Join("\n", failures));
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
