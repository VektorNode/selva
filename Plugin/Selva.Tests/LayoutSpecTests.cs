using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

public class LayoutSpecTests
{
    private static readonly Guid Width = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Kind = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid Enabled = Guid.Parse("00000000-0000-0000-0000-000000000003");
    private static readonly Guid Files = Guid.Parse("00000000-0000-0000-0000-000000000004");

    private static UISchema Canvas()
    {
        return new UISchema
        {
            Id = "s",
            Name = "Wall cap",
            Inputs =
            [
                new SchemaInput { Id = Width, Nickname = "Width", ParamType = "number", Description = "In mm." },
                new SchemaInput { Id = Kind, Nickname = "Kind", ParamType = "valueList" },
                new SchemaInput { Id = Enabled, Nickname = "End cap", ParamType = "boolean" }
            ],
            Outputs = [new SchemaOutput { Id = Files, Nickname = "_Data", Type = "file" }],
            Layout = new TabbedLayoutConfig()
        };
    }

    private static LayoutSpec.Outcome Apply(UISchema schema, string spec)
    {
        return LayoutSpec.Apply(schema, JObject.Parse(spec),
            (id, widget) => id == Kind && widget == "dropdown"
                ? new JObject { ["options"] = new JObject { ["Flat"] = "flat", ["Sloped"] = "sloped" } }
                : null);
    }

    private static string Json(UISchema schema)
    {
        var copy = JObject.Parse(JsonConvert.SerializeObject(schema, SchemaSerializationSettings.Settings));
        copy.Remove("lastModified");
        copy.Remove("created");
        return copy.ToString();
    }

    private const string Form = """
        { "tabs": [
            { "label": "General", "groups": [
                { "label": "Size", "items": [
                    { "param": "Width", "config": { "minimum": 50, "maximum": 800 } },
                    { "linebreak": true },
                    "Kind" ] },
                { "label": "Ends", "collapsed": true, "items": [ { "param": "End cap", "label": "Cap" } ] } ] },
            { "label": "Export", "visible": false, "groups": [
                { "label": "Files", "items": [ "_Data" ] } ] } ] }
        """;

    [Fact]
    public void Apply_PlacesByNickname_WithWidgetsFromParamTypes()
    {
        var outcome = Apply(Canvas(), Form);

        Assert.Empty(outcome.Errors);
        var tabs = ((TabbedLayoutConfig)outcome.Schema.Layout).Tabs;
        Assert.Equal(new[] { "tab-general", "tab-export" }, tabs.Select(t => t.Id));
        var size = tabs[0].Groups[0];
        var width = Assert.IsType<InputNumberLayoutItem>(size.Items[0]);
        Assert.Equal(Width, width.ParamId);
        Assert.Equal(800, width.Config.Maximum);
        Assert.Equal("In mm.", width.Description);
        Assert.IsType<LineBreakLayoutItem>(size.Items[1]);
        var kind = Assert.IsType<InputDropdownLayoutItem>(size.Items[2]);
        Assert.Equal("sloped", kind.Config.Options["Sloped"]);
        Assert.True(tabs[0].Groups[1].Collapsed);
        Assert.Equal("Cap", Assert.IsType<InputCheckboxLayoutItem>(tabs[0].Groups[1].Items[0]).DisplayName);
        Assert.IsType<OutputFileLayoutItem>(tabs[1].Groups[0].Items[0]);
        Assert.False(tabs[1].Visible);
    }

    [Fact]
    public void ReadThenApply_ChangesNothing()
    {
        var laidOut = Apply(Canvas(), Form).Schema;

        var again = LayoutSpec.Apply(laidOut, LayoutSpec.Read(laidOut));

        Assert.Empty(again.Errors);
        Assert.Equal(Json(laidOut), Json(again.Schema));
    }

    [Fact]
    public void Apply_KeepsWhatTheSpecLeavesOut_AndMergesConfig()
    {
        var laidOut = Apply(Canvas(), Form).Schema;

        var moved = Apply(laidOut, """
            { "tabs": [ { "label": "Other", "groups": [ { "label": "Size", "items": [
                { "param": "Width", "config": { "maximum": 900 } } ] } ] } ] }
            """);

        var group = ((TabbedLayoutConfig)moved.Schema.Layout).Tabs[0].Groups[0];
        var width = Assert.IsType<InputNumberLayoutItem>(Assert.Single(group.Items));
        Assert.Equal("grp-size", group.Id);
        Assert.Equal("item-width", width.Id);
        Assert.Equal(50, width.Config.Minimum);
        Assert.Equal(900, width.Config.Maximum);
        Assert.Equal(new[] { "Kind", "End cap", "_Data" }, moved.Unplaced);
    }

    [Fact]
    public void Apply_RefusesTheWholeSpec_NamingEachError()
    {
        var schema = Canvas();
        var before = Json(schema);

        var outcome = Apply(schema, """
            { "tabs": [ { "label": "General", "colapsed": true, "groups": [ { "label": "Size", "items": [
                "Width", "Widht", "Width" ] } ] } ] }
            """);

        Assert.Null(outcome.Schema);
        Assert.Contains(outcome.Errors, e => e.Contains("unknown key \"colapsed\""));
        Assert.Contains(outcome.Errors, e => e.Contains("nothing on the canvas is named \"Widht\""));
        Assert.Contains(outcome.Errors, e => e.Contains("\"Width\" is placed twice"));
        Assert.Equal(before, Json(schema));
    }

    [Fact]
    public void Apply_ResolvesVisibilityRulesByNickname()
    {
        var outcome = Apply(Canvas(), """
            { "groups": [ { "label": "Main", "items": [ "End cap",
                { "param": "Width", "visibilityCondition": { "rules": [
                    { "param": "End cap", "operator": "equals", "value": true } ] } } ] } ] }
            """);

        var width = ((FlatLayoutConfig)outcome.Schema.Layout).Groups[0].Items[1];
        Assert.Equal(Enabled.ToString(), width.VisibilityCondition.Rules[0].ParamId);
        var read = LayoutSpec.Read(outcome.Schema);
        Assert.Equal("End cap", (string)read.SelectToken("groups[0].items[1].visibilityCondition.rules[0].param"));
    }

    [Fact]
    public void Apply_SetsInputDescriptionAndDefault()
    {
        var outcome = Apply(Canvas(), """
            { "groups": [ { "label": "Main", "items": [
                { "param": "Width", "description": "Cap width, in mm.", "default": 250 } ] } ] }
            """);

        var input = outcome.Schema.Inputs.Single(i => i.Id == Width);
        Assert.Equal("Cap width, in mm.", input.Description);
        Assert.Equal(250L, input.Default);
    }
}
