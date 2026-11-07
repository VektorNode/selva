using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;

namespace Selva.Tests;

/// <summary>
///     Data-driven fixture tests for schema migration and validation. Drop a JSON file in
///     TestFiles/schemas/vX.Y.Z.json and it's auto-discovered and run against the generic
///     invariants below; add a CreateExpectations() entry for per-fixture assertions.
/// </summary>
public class SchemaFixtureTests
{
    /// <summary>Expectations keyed by fixture filename (e.g. "v1.0.0.json").</summary>
    private static Dictionary<string, FixtureExpectations> CreateExpectations()
    {
        return new Dictionary<string, FixtureExpectations>
        {
            ["v1.0.0.json"] = new FixtureExpectations
            {
                InputCount = 2,
                OutputCount = 1,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["Width"] = new InputExpectation { ParamType = "number", InputStructure = "item" },
                    ["Height"] = new InputExpectation { ParamType = "number", InputStructure = "item" }
                }
            },
            ["v2.2.0.json"] = new FixtureExpectations
            {
                InputCount = 2,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["Width"] = new InputExpectation { ParamType = "number", InputStructure = "item" },
                    ["Material Color"] = new InputExpectation { ParamType = "color", InputStructure = "item" }
                }
            },
            ["v2.3.0.json"] = new FixtureExpectations
            {
                InputCount = 4,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["Width"] = new InputExpectation { InputStructure = "item" },
                    ["Points"] = new InputExpectation { InputStructure = "list" },
                    ["DataTree"] = new InputExpectation { InputStructure = "tree" },
                    ["OmittedDefaultsToItem"] = new InputExpectation { InputStructure = "item" }
                }
            },
            ["v2.4.0.json"] = new FixtureExpectations
            {
                InputCount = 1,
                OutputCount = 2,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["DataInput"] = new InputExpectation { ParamType = "generic", InputStructure = "list" }
                }
            },
            ["v2.9.0.json"] = new FixtureExpectations
            {
                InputCount = 4,
                OutputCount = 2,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["Outline"] = new InputExpectation { ParamType = "generic", InputStructure = "item" },
                    ["Finishes"] = new InputExpectation { ParamType = "valueList", InputStructure = "list" }
                }
            },
            ["v2.17.0.json"] = new FixtureExpectations
            {
                InputCount = 6,
                OutputCount = 2,
                Inputs = new Dictionary<string, InputExpectation>
                {
                    ["Profile"] = new InputExpectation { ParamType = "dynamicValueList", InputStructure = "item" },
                    ["Site"] = new InputExpectation { ParamType = "geometry", InputStructure = "list" }
                }
            }
        };
    }

    // -------------------------------------------------------------------------
    // Auto-discovery: all files in TestFiles/schemas/ are tested
    // -------------------------------------------------------------------------

    public static IEnumerable<object[]> AllFixtureFiles()
    {
        var dir = Path.Combine("TestFiles", "schemas");
        if (!Directory.Exists(dir))
        {
            yield break;
        }

        foreach (var file in Directory.GetFiles(dir, "v*.json").OrderBy(f => f))
        {
            yield return new object[] { Path.GetFileName(file) };
        }
    }

    // -------------------------------------------------------------------------
    // Generic invariants — run for every fixture automatically
    // -------------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_ParsesWithoutError(string fileName)
    {
        var json = ReadFixture(fileName);
        var ex = Record.Exception(() => JObject.Parse(json));
        Assert.Null(ex);
    }

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_MigrationPipelineSucceeds(string fileName)
    {
        var schema = FullMigration(ReadFixture(fileName));
        Assert.NotNull(schema);
    }

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_ProducesCurrentSchemaVersion(string fileName)
    {
        var schema = FullMigration(ReadFixture(fileName));
        Assert.Equal(SchemaVersion.CURRENT_STRING, schema.SchemaVersion);
    }

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_AllInputsHaveInputStructure(string fileName)
    {
        var schema = FullMigration(ReadFixture(fileName));
        Assert.All(schema.Inputs, input =>
        {
            Assert.NotNull(input.InputStructure);
            Assert.Contains(input.InputStructure, new[] { "item", "list", "tree" });
        });
    }

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_AllOutputsHaveType(string fileName)
    {
        var schema = FullMigration(ReadFixture(fileName));
        Assert.All(schema.Outputs, output => Assert.NotNull(output.Type));
    }

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_LayoutIsNonNullWithType(string fileName)
    {
        var schema = FullMigration(ReadFixture(fileName));
        Assert.NotNull(schema.Layout);
        Assert.True(
            schema.Layout is TabbedLayoutConfig or FlatLayoutConfig,
            $"Expected TabbedLayoutConfig or FlatLayoutConfig, got {schema.Layout.GetType().Name}");
    }

    // -------------------------------------------------------------------------
    // Per-fixture expectations — run only for files that have an entry
    // -------------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_MeetsExpectations(string fileName)
    {
        var expectations = CreateExpectations();
        if (!expectations.TryGetValue(fileName, out var expected))
        {
            return; // No expectations registered — generic invariants above are enough
        }

        var schema = FullMigration(ReadFixture(fileName));

        AssertExpectations(schema, expected, fileName);
    }

    // -------------------------------------------------------------------------
    // Typed steps run on load, from the version the schema was saved at
    // -------------------------------------------------------------------------

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_LoadAppliesEveryTypedStepAfterItsSavedVersion(string fileName)
    {
        var raw = JObject.Parse(ReadFixture(fileName));
        var saved = Version.Parse(raw["schemaVersion"]?.Value<string>() ?? "1.0.0");

        var (_, changes) = Load(ReadFixture(fileName));

        var steps = SchemaMigrator.GetMigrationPath(saved, SchemaVersion.CURRENT);
        Assert.Equal(steps.Select(v => v.ToString()),
            changes.Where(c => c.StartsWith("Applied migration")).Select(c => c.Split(' ').Last()));
    }

    [Fact]
    public void V2_9_0_FoldsPathAndProducerIntoKeyAndDropsOnMissing()
    {
        var (schema, _) = Load(ReadFixture("v2.9.0.json"));

        var items = ((FlatLayoutConfig)schema.Layout).Groups[0].Items;
        var outline = (InputTextLayoutItem)items.Single(i => i.Id == "item-outline");
        var measured = (InputTextLayoutItem)items.Single(i => i.Id == "item-measured");
        Assert.Equal(("server", "capture.outline"), (outline.Source.Kind, outline.Source.Key));
        Assert.Equal(("client", "line-app"), (measured.Source.Kind, measured.Source.Key));

        var saved = JObject.Parse(JsonConvert.SerializeObject(schema, SchemaSerializationSettings.Settings));
        var savedSources = saved.SelectTokens("$.layout.groups[*].items[*].source").Cast<JObject>().ToList();
        Assert.Equal(2, savedSources.Count);
        Assert.All(savedSources, source =>
            Assert.Equal(new[] { "key", "kind" }, source.Properties().Select(p => p.Name).OrderBy(n => n)));
    }

    [Fact]
    public void V2_17_0_KeepsOptionMediaAndAssets()
    {
        var (schema, _) = Load(ReadFixture("v2.17.0.json"));

        var roof = (InputDropdownLayoutItem)((TabbedLayoutConfig)schema.Layout).Tabs[0].Groups[0].Items
            .Single(i => i.Id == "item-roof");
        Assert.Equal("tiles", roof.Config.DisplayAs);
        Assert.Equal("roof-flat", roof.Config.OptionMedia["Flat"].Image);
        Assert.Equal("lucide:house", roof.Config.OptionMedia["Gable"].IconName);
        Assert.Equal("M3 12l9-9 9 9", schema.Assets["roof-gable"].D);
        Assert.Null(schema.LocalOptions);
    }

    // Migration isn't an edit: the timestamp moves when the user saves.
    [Fact]
    public void Load_KeepsTheSavedLastModified()
    {
        var (schema, _) = Load(ReadFixture("v2.17.0.json"));

        Assert.Equal(new DateTime(2026, 10, 26, 16, 45, 0, DateTimeKind.Utc), schema.LastModified.ToUniversalTime());
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static void AssertExpectations(UISchema schema, FixtureExpectations expected, string fileName)
    {
        if (expected.InputCount.HasValue)
        {
            Assert.Equal(expected.InputCount.Value, schema.Inputs.Count);
        }

        if (expected.OutputCount.HasValue)
        {
            Assert.Equal(expected.OutputCount.Value, schema.Outputs.Count);
        }

        foreach (var (nickname, inputExpected) in expected.Inputs)
        {
            var input = schema.Inputs.FirstOrDefault(i => i.Nickname == nickname);
            Assert.NotNull(input); // Nickname "{nickname}" not found in {fileName}

            if (inputExpected.ParamType != null)
            {
                Assert.Equal(inputExpected.ParamType, input.ParamType);
            }

            if (inputExpected.InputStructure != null)
            {
                Assert.Equal(inputExpected.InputStructure, input.InputStructure);
            }
        }
    }

    private static UISchema FullMigration(string rawJson)
    {
        return Load(rawJson).Schema;
    }

    // What SchemaArchiveSerializer calls when a .gh loads.
    private static (UISchema Schema, List<string> Changes) Load(string rawJson)
    {
        return SchemaMigrator.Migrate(JObject.Parse(rawJson), new Version(99, 0, 0));
    }

    private static string ReadFixture(string fileName)
    {
        return File.ReadAllText(Path.Combine("TestFiles", "schemas", fileName));
    }

    // -------------------------------------------------------------------------
    // Per-fixture expectations
    // -------------------------------------------------------------------------

    /// <summary>Null fields skip that assertion for the fixture.</summary>
    private class FixtureExpectations
    {
        public int? InputCount { get; init; }
        public int? OutputCount { get; init; }
        public Dictionary<string, InputExpectation> Inputs { get; init; } = new Dictionary<string, InputExpectation>();
    }

    private class InputExpectation
    {
        public string? ParamType { get; init; }
        public string? InputStructure { get; init; }
    }
}
