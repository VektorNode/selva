using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;
using Selva.Schema.Services;
using Selva.Schema.Services.Validation;

namespace Selva.Tests;

public class OptionMediaTests
{
    private static readonly Guid ParamId = new("bbbbbbbb-0000-0000-0000-000000000001");

    private static UISchema SchemaWithDropdown(DropdownWidgetConfig config, Dictionary<string, OptionAsset>? assets = null)
    {
        return new UISchema
        {
            Id = "s",
            Name = "Pavilion",
            SchemaVersion = SchemaVersion.CURRENT_STRING,
            PluginVersion = "1.0.0",
            Inputs = new List<SchemaInput> { new() { Id = ParamId, Nickname = "Timber", ParamType = "valueList" } },
            Outputs = new List<SchemaOutput>(),
            Assets = assets,
            Layout = new FlatLayoutConfig
            {
                Groups = new List<GroupConfig>
                {
                    new()
                    {
                        Id = "g1",
                        Label = "Material",
                        Items = new List<LayoutItemBase>
                        {
                            new InputDropdownLayoutItem { Id = "i1", ParamId = ParamId, Config = config }
                        }
                    }
                }
            }
        };
    }

    private static DropdownWidgetConfig Timber(Dictionary<string, OptionMedia>? media = null)
    {
        return new DropdownWidgetConfig
        {
            Options = new Dictionary<string, object> { ["Oak"] = "0", ["Larch"] = "1" },
            OptionMedia = media
        };
    }

    // -------------------------------------------------------------------------
    // MinPluginVersionStamp
    // -------------------------------------------------------------------------

    [Fact]
    public void Stamp_SchemaWithAssets_RequiresTheVersionThatReadsThem()
    {
        var schema = SchemaWithDropdown(Timber(), new Dictionary<string, OptionAsset> { ["a1"] = new() { D = "M3 3h18" } });

        MinPluginVersionStamp.Apply(schema);

        Assert.Equal("0.23.0", schema.MinPluginVersion);
    }

    [Fact]
    public void Stamp_SchemaWithoutAssets_LeavesMinPluginVersionUnset()
    {
        var schema = SchemaWithDropdown(Timber());

        MinPluginVersionStamp.Apply(schema);

        Assert.Null(schema.MinPluginVersion);
    }

    [Fact]
    public void Stamp_NewerRequirementAlreadySet_IsKept()
    {
        var schema = SchemaWithDropdown(Timber(), new Dictionary<string, OptionAsset> { ["a1"] = new() { D = "M3 3h18" } });
        schema.MinPluginVersion = "1.4.0";

        MinPluginVersionStamp.Apply(schema);

        Assert.Equal("1.4.0", schema.MinPluginVersion);
    }

    // -------------------------------------------------------------------------
    // Validation
    // -------------------------------------------------------------------------

    private static readonly SchemaValidator Validator = new();

    private static Dictionary<string, OptionAsset> Assets(params (string id, OptionAsset asset)[] entries)
    {
        return entries.ToDictionary(e => e.id, e => e.asset);
    }

    [Fact]
    public void Validate_IconAndImageResolve_NoIssues()
    {
        var schema = SchemaWithDropdown(
            Timber(new Dictionary<string, OptionMedia> { ["Oak"] = new() { Icon = "i1", Image = "p1" } }),
            Assets(("i1", new OptionAsset { D = "M3 3h18" }),
                ("p1", new OptionAsset { Img = "data:image/webp;base64,UklGRg==", W = 192, H = 192 })));

        var result = Validator.Validate(schema);

        Assert.Empty(result.Issues.Where(i => i.Message.Contains("Oak") || i.Message.Contains("asset")));
    }

    [Fact]
    public void Validate_OptionMediaPointsAtMissingAsset_ReturnsError()
    {
        var schema = SchemaWithDropdown(
            Timber(new Dictionary<string, OptionMedia> { ["Oak"] = new() { Icon = "gone" } }));

        var result = Validator.Validate(schema);

        Assert.Contains(result.Errors, i => i.Message.Contains("Oak") && i.Message.Contains("gone"));
    }

    [Fact]
    public void Validate_AssetWithBothPathAndImage_ReturnsError()
    {
        var schema = SchemaWithDropdown(Timber(),
            Assets(("a1", new OptionAsset { D = "M3 3h18", Img = "data:image/png;base64,iVBO" })));

        var result = Validator.Validate(schema);

        Assert.Contains(result.Errors, i => i.Message.Contains("a1"));
    }

    [Fact]
    public void Validate_ImageThatIsNotARasterDataUri_ReturnsError()
    {
        var schema = SchemaWithDropdown(Timber(),
            Assets(("a1", new OptionAsset { Img = "data:image/svg+xml;base64,PHN2Zz4=" })));

        var result = Validator.Validate(schema);

        Assert.Contains(result.Errors, i => i.Message.Contains("a1"));
    }

    [Fact]
    public void Validate_OversizedAsset_ReturnsWarning()
    {
        var schema = SchemaWithDropdown(Timber(),
            Assets(("a1", new OptionAsset { Img = "data:image/jpeg;base64," + new string('A', 100_000) })));

        var result = Validator.Validate(schema);

        Assert.Contains(result.Warnings, i => i.Message.Contains("a1"));
        Assert.DoesNotContain(result.Errors, i => i.Message.Contains("a1"));
    }

    // -------------------------------------------------------------------------
    // Round-trip
    // -------------------------------------------------------------------------

    [Fact]
    public void RoundTrip_KeepsTypedMediaAndOptionNameCase()
    {
        var schema = SchemaWithDropdown(
            Timber(new Dictionary<string, OptionMedia> { ["Oak"] = new() { Icon = "i1", IconName = "lucide:tree-deciduous" } }),
            Assets(("i1", new OptionAsset { D = "M3 3h18" })));

        var json = JsonConvert.SerializeObject(schema, SchemaSerializationSettings.Settings);
        var back = JObject.Parse(json).ToObject<UISchema>()!;

        var item = (InputDropdownLayoutItem)((FlatLayoutConfig)back.Layout).Groups[0].Items[0];
        Assert.Equal("i1", item.Config.OptionMedia["Oak"].Icon);
        Assert.Equal("M3 3h18", back.Assets["i1"].D);
    }

    [Fact]
    public void Migrate_From2_16_ReachesCurrentWithoutTouchingOptions()
    {
        var schema = SchemaWithDropdown(Timber());
        schema.SchemaVersion = "2.16.0";

        var migrated = SchemaMigrator.MigrateToCurrentVersion(schema, new Version(0, 23, 0));

        Assert.Equal(SchemaVersion.CURRENT_STRING, migrated.SchemaVersion);
        var item = (InputDropdownLayoutItem)((FlatLayoutConfig)migrated.Layout).Groups[0].Items[0];
        Assert.Null(item.Config.OptionMedia);
        Assert.Equal(2, item.Config.Options.Count);
    }
}
