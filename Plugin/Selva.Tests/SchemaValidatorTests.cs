using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;
using Selva.Schema.Services.Validation;

namespace Selva.Tests;

/// <summary>
///     Tests for SchemaValidator and all individual validation rules.
///     Structure:
///     - Fixture_* : every valid fixture file must pass with no errors
///     - BasicStructure_* : BasicStructureRule
///     - Parameters_* : ParameterValidationRule
///     - Layout_* : LayoutValidationRule
///     - WidgetConfig_* : WidgetConfigRule
///     - Versioning_* : VersioningRule
///     - Constraints_* : ConstraintsRule
/// </summary>
public class SchemaValidatorTests
{
    private readonly SchemaValidator _validator = new SchemaValidator();

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static Guid Id(int n)
    {
        return new Guid($"aaaaaaaa-0000-0000-0000-{n:D12}");
    }

    private static UISchema ValidSchema(Action<UISchema>? configure = null)
    {
        var id = Id(1);
        var schema = new UISchema
        {
            Id = "s",
            Name = "Test",
            SchemaVersion = SchemaVersion.CURRENT_STRING,
            PluginVersion = "1.0.0",
            Inputs = new List<SchemaInput>
            {
                new SchemaInput { Id = id, Nickname = "Width", ParamType = "number" }
            },
            Outputs = new List<SchemaOutput>(),
            Layout = new FlatLayoutConfig
            {
                Groups = new List<GroupConfig>
                {
                    new GroupConfig
                    {
                        Id = "g1",
                        Label = "Params",
                        Items = new List<LayoutItemBase>
                        {
                            new InputNumberLayoutItem { Id = "item1", ParamId = id, DisplayName = "Width" }
                        }
                    }
                }
            }
        };
        configure?.Invoke(schema);
        return schema;
    }

    // -------------------------------------------------------------------------
    // Fixture files — every valid fixture must produce no errors after migration
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

    [Theory]
    [MemberData(nameof(AllFixtureFiles))]
    public void Fixture_ValidFile_PassesValidationWithNoErrors(string fileName)
    {
        var json = File.ReadAllText(Path.Combine("TestFiles", "schemas", fileName));
        var jObject = JObject.Parse(json);
        jObject = SchemaMigrator.MigrateJson(jObject);
        var schema = jObject.ToObject<UISchema>();
        schema = SchemaMigrator.MigrateToCurrentVersion(schema, new Version(99, 0, 0));

        var result = _validator.Validate(schema);

        var errors = result.Issues.Where(i => i.Severity == ValidationSeverity.Error).ToList();
        Assert.Empty(errors);
    }

    // -------------------------------------------------------------------------
    // BasicStructureRule
    // -------------------------------------------------------------------------

    [Fact]
    public void BasicStructure_NullSchema_ReturnsFailure()
    {
        var result = _validator.Validate(null);
        Assert.False(result.IsValid);
        Assert.Contains(result.Issues, i => i.Message == "Schema is null");
    }

    [Fact]
    public void BasicStructure_MissingId_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => s.Id = null));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message == "Schema ID is required");
    }

    [Fact]
    public void BasicStructure_MissingName_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => s.Name = null));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message == "Schema name is required");
    }

    [Fact]
    public void BasicStructure_NullLayout_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => s.Layout = null));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message == "Layout is null");
    }

    [Fact]
    public void BasicStructure_ValidSchema_NoErrors()
    {
        var result = _validator.Validate(ValidSchema());
        Assert.DoesNotContain(result.Issues, i => i.Severity == ValidationSeverity.Error);
    }

    // -------------------------------------------------------------------------
    // ParameterValidationRule
    // -------------------------------------------------------------------------

    [Fact]
    public void Parameters_DuplicateInputId_ReturnsError()
    {
        var dupeId = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs = new List<SchemaInput>
            {
                new SchemaInput { Id = dupeId, Nickname = "A", ParamType = "number" },
                new SchemaInput { Id = dupeId, Nickname = "B", ParamType = "number" }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("Duplicate input"));
    }

    [Fact]
    public void Parameters_EmptyInputId_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs = new List<SchemaInput>
            {
                new SchemaInput { Id = Guid.Empty, Nickname = "X", ParamType = "number" }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("empty ID"));
    }

    [Fact]
    public void Parameters_MissingParamType_ReturnsWarning()
    {
        var result = _validator.Validate(ValidSchema(s => s.Inputs[0].ParamType = null));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("no param type"));
    }

    // -------------------------------------------------------------------------
    // LayoutValidationRule
    // -------------------------------------------------------------------------

    [Fact]
    public void Layout_ItemReferencesNonExistentInput_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s =>
        {
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] =
                new InputNumberLayoutItem { Id = "item1", ParamId = Id(999) };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("non-existent input parameter"));
    }

    [Fact]
    public void Layout_DuplicateItemId_ReturnsError()
    {
        var paramId = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            ((FlatLayoutConfig)s.Layout).Groups[0].Items = new List<LayoutItemBase>
            {
                new InputNumberLayoutItem { Id = "dupe", ParamId = paramId },
                new InputNumberLayoutItem { Id = "dupe", ParamId = paramId }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("Duplicate layout item ID"));
    }

    [Fact]
    public void Layout_UnusedInput_ReturnsWarning()
    {
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs.Add(new SchemaInput { Id = Id(2), Nickname = "Orphan", ParamType = "number" });
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("Unused input parameters"));
    }

    [Fact]
    public void Layout_InvalidSpan_ReturnsError()
    {
        var result =
            _validator.Validate(ValidSchema(s => { ((FlatLayoutConfig)s.Layout).Groups[0].Items[0].Span = 0; }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("invalid span"));
    }

    [Fact]
    public void Layout_InvalidColumns_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => { ((FlatLayoutConfig)s.Layout).Groups[0].Columns = 0; }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("invalid column count"));
    }

    // -------------------------------------------------------------------------
    // WidgetConfigRule
    // -------------------------------------------------------------------------

    [Fact]
    public void WidgetConfig_NumberWidget_MinGreaterThanMax_ReturnsError()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputNumberLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new NumberWidgetConfig { Minimum = 100, Maximum = 10 }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("min/max range"));
    }

    [Fact]
    public void WidgetConfig_NumberWidget_NegativeStep_ReturnsError()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputNumberLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new NumberWidgetConfig { Minimum = 0, Maximum = 100, StepSize = -1 }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("step size"));
    }

    [Fact]
    public void WidgetConfig_NumberWidget_StepLargerThanRange_ReturnsWarning()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputNumberLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new NumberWidgetConfig { Minimum = 0, Maximum = 10, StepSize = 100 }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("Step size"));
    }

    [Fact]
    public void WidgetConfig_DropdownWithNoOptions_ReturnsError()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs[0].ParamType = "valueList";
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputDropdownLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new DropdownWidgetConfig { Options = new Dictionary<string, object>() }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("no options"));
    }

    [Fact]
    public void WidgetConfig_TextWidget_InvalidRegex_ReturnsError()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs[0].ParamType = "text";
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputTextLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new TextWidgetConfig { Pattern = "[invalid((regex" }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("invalid regex pattern"));
    }

    [Fact]
    public void WidgetConfig_TextWidget_ZeroMaxLength_ReturnsError()
    {
        var id = Id(1);
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs[0].ParamType = "text";
            ((FlatLayoutConfig)s.Layout).Groups[0].Items[0] = new InputTextLayoutItem
            {
                Id = "item1", ParamId = id,
                Config = new TextWidgetConfig { MaxLength = 0 }
            };
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("maxLength"));
    }

    // -------------------------------------------------------------------------
    // VersioningRule
    // -------------------------------------------------------------------------

    [Fact]
    public void Versioning_MalformedSchemaVersion_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => s.SchemaVersion = "not-a-version"));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("Invalid schema version format"));
    }

    [Fact]
    public void Versioning_MalformedPluginVersion_ReturnsWarning()
    {
        var result = _validator.Validate(ValidSchema(s => s.PluginVersion = "not-a-version"));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("Invalid plugin version format"));
    }

    [Fact]
    public void Versioning_MalformedMinPluginVersion_ReturnsError()
    {
        var result = _validator.Validate(ValidSchema(s => s.MinPluginVersion = "bad"));
        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Error && i.Message.Contains("Invalid minimum plugin version format"));
    }

    // -------------------------------------------------------------------------
    // ConstraintsRule
    // -------------------------------------------------------------------------

    [Fact]
    public void Constraints_NoInputsOrOutputs_ReturnsWarning()
    {
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Inputs = new List<SchemaInput>();
            s.Outputs = new List<SchemaOutput>();
            ((FlatLayoutConfig)s.Layout).Groups[0].Items = new List<LayoutItemBase>();
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("no inputs or outputs"));
    }

    [Fact]
    public void Constraints_LastModifiedBeforeCreated_ReturnsWarning()
    {
        var result = _validator.Validate(ValidSchema(s =>
        {
            s.Created = new DateTime(2025, 6, 1, 0, 0, 0, DateTimeKind.Utc);
            s.LastModified = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        }));

        Assert.Contains(result.Issues, i =>
            i.Severity == ValidationSeverity.Warning && i.Message.Contains("LastModified is earlier than Created"));
    }
}
