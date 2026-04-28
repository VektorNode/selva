using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;

namespace Selva.Tests;

/// <summary>
///     Data-driven fixture tests for schema migration and validation.
///     HOW TO ADD A NEW SCHEMA VERSION:
///     1. Drop a JSON file in TestFiles/schemas/vX.Y.Z.json — it will be picked up automatically.
///     2. Add a matching FixtureExpectations entry in CreateExpectations() below.
///     3. If a field changes behaviour, update the corresponding assertion in AssertExpectations().
///     WHAT EACH FIXTURE FILE TESTS (automatically, no extra code needed):
///     - The file parses without error
///     - Full migration pipeline runs without throwing
///     - Final schemaVersion == SchemaVersion.CURRENT_STRING
///     - All inputs have a non-null inputStructure ("item" | "list" | "tree")
///     - All outputs have a non-null type
///     - Layout is non-null and has a discriminator type ("tabbed" or "flat")
/// </summary>
public class SchemaFixtureTests
{
    /// <summary>
    ///     Returns expectations keyed by fixture filename (e.g. "v1.0.0.json").
    ///     TO ADD NEW VERSION: add an entry here matching your new fixture file.
    /// </summary>
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

    /// <summary>
    ///     Runs the full two-phase migration pipeline the same way SchemaArchiveSerializer does.
    /// </summary>
    private static UISchema FullMigration(string rawJson)
    {
        var jObject = JObject.Parse(rawJson);
        jObject = SchemaMigrator.MigrateJson(jObject);
        var schema = jObject.ToObject<UISchema>();
        return SchemaMigrator.MigrateToCurrentVersion(schema, new Version(99, 0, 0));
    }

    private static string ReadFixture(string fileName)
    {
        return File.ReadAllText(Path.Combine("TestFiles", "schemas", fileName));
    }
    // -------------------------------------------------------------------------
    // Per-fixture expectations
    // -------------------------------------------------------------------------

    /// <summary>
    ///     Expectations for a specific fixture file. Only set fields you want to assert.
    ///     Leave a field null to skip that assertion for this fixture.
    /// </summary>
    private class FixtureExpectations
    {
        /// <summary>How many inputs the fixture should have after migration.</summary>
        public int? InputCount { get; init; }

        /// <summary>How many outputs the fixture should have after migration.</summary>
        public int? OutputCount { get; init; }

        /// <summary>
        ///     Per-input expectations keyed by input nickname.
        ///     Only specify inputs you want to assert on — others are ignored.
        /// </summary>
        public Dictionary<string, InputExpectation> Inputs { get; init; } = new Dictionary<string, InputExpectation>();
    }

    private class InputExpectation
    {
        public string? ParamType { get; init; }
        public string? InputStructure { get; init; }
    }
}
