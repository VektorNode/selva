using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

public class LayoutPlacementTests
{
    private static readonly Guid Width = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid Height = Guid.Parse("00000000-0000-0000-0000-000000000002");
    private static readonly Guid Shape = Guid.Parse("00000000-0000-0000-0000-000000000003");
    private static readonly Guid Area = Guid.Parse("00000000-0000-0000-0000-000000000004");

    private static UISchema LaidOut()
    {
        var canvas = new UISchema
        {
            Id = "s",
            Name = "Wall cap",
            Inputs =
            [
                new SchemaInput { Id = Width, Nickname = "Width", ParamType = "number" },
                new SchemaInput { Id = Height, Nickname = "Height", ParamType = "number" },
                new SchemaInput { Id = Shape, Nickname = "Shape", ParamType = "geometry" }
            ],
            Outputs = [new SchemaOutput { Id = Area, Nickname = "Area", Type = "number" }],
            Layout = new TabbedLayoutConfig()
        };
        var outcome = LayoutSpec.Apply(canvas, JObject.Parse("""
            { "tabs": [
                { "label": "General", "groups": [
                    { "label": "Size", "items": [ { "param": "Width", "label": "Breite", "config": { "maximum": 800 } } ] },
                    { "label": "Other", "items": [] } ] },
                { "label": "Output", "groups": [ { "label": "Results", "items": [] } ] } ] }
            """));
        Assert.Empty(outcome.Errors);
        return outcome.Schema;
    }

    private static List<TabConfig> Tabs(UISchema schema) => ((TabbedLayoutConfig)schema.Layout).Tabs;

    [Fact]
    public void Place_AppendsNewItems_InTheGivenOrder()
    {
        var schema = LaidOut();
        var size = Tabs(schema)[0].Groups[0];

        var outcome = LayoutPlacement.Place(schema, new[] { Height, Shape },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, GroupId = size.Id });

        Assert.Empty(outcome.Errors);
        var items = Tabs(outcome.Schema)[0].Groups[0].Items;
        Assert.Equal(new[] { Width, Height, Shape }, items.Select(i => i.ParamId));
        Assert.Equal(new[] { Height, Shape }, outcome.Added);
        Assert.Empty(outcome.Moved);
        Assert.All(outcome.Placed, p => Assert.Equal(size.Id, p.GroupId));
    }

    [Fact]
    public void Place_GivesGeometryParamsTheTextPlaceholder()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Place(schema, new[] { Shape },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, GroupId = Tabs(schema)[0].Groups[1].Id });

        Assert.Empty(outcome.Errors);
        Assert.Equal("text", Tabs(outcome.Schema)[0].Groups[1].Items.Single().WidgetType);
    }

    [Fact]
    public void Place_MovesAPlacedParam_KeepingItsLabelAndConfig()
    {
        var schema = LaidOut();
        var other = Tabs(schema)[0].Groups[1];
        var before = Tabs(schema)[0].Groups[0].Items.Single();

        var outcome = LayoutPlacement.Place(schema, new[] { Width },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, GroupId = other.Id });

        Assert.Empty(outcome.Errors);
        Assert.Equal(new[] { Width }, outcome.Moved);
        Assert.Empty(Tabs(outcome.Schema)[0].Groups[0].Items);
        var moved = Assert.IsType<InputNumberLayoutItem>(Tabs(outcome.Schema)[0].Groups[1].Items.Single());
        Assert.Equal("Breite", moved.DisplayName);
        Assert.Equal(800, moved.Config.Maximum);
        Assert.Equal(before.Id, moved.Id);
    }

    [Fact]
    public void Place_IntoTheGroupItIsIn_ChangesNothing()
    {
        var schema = LaidOut();
        var size = Tabs(schema)[0].Groups[0];

        var outcome = LayoutPlacement.Place(schema, new[] { Width },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, GroupId = size.Id });

        Assert.Empty(outcome.Errors);
        Assert.Empty(outcome.Placed);
        Assert.Equal(new[] { Width }, Tabs(outcome.Schema)[0].Groups[0].Items.Select(i => i.ParamId));
    }

    [Fact]
    public void Place_InANewGroup_ReusesAGroupOfTheSameName()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Place(schema, new[] { Height },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, NewGroupLabel = "size" });

        Assert.Empty(outcome.Errors);
        Assert.Equal(2, Tabs(outcome.Schema)[0].Groups.Count);
        Assert.Equal(new[] { Width, Height }, Tabs(outcome.Schema)[0].Groups[0].Items.Select(i => i.ParamId));
    }

    [Fact]
    public void Place_InANewTab_CreatesTabAndGroup_AndReportsTheirIds()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Place(schema, new[] { Area, Height },
            new LayoutPlacement.Target { NewTabLabel = "Export", NewGroupLabel = "Numbers" });

        Assert.Empty(outcome.Errors);
        var tab = Tabs(outcome.Schema).Last();
        Assert.Equal("Export", tab.Label);
        var group = tab.Groups.Single();
        Assert.Equal("Numbers", group.Label);
        Assert.Equal(new[] { Area, Height }, group.Items.Select(i => i.ParamId));
        Assert.IsType<OutputNumberLayoutItem>(group.Items[0]);
        Assert.All(outcome.Placed, p =>
        {
            Assert.Equal(tab.Id, p.TabId);
            Assert.Equal(group.Id, p.GroupId);
        });
        Assert.True(outcome.Placed.Single(p => p.ParamId == Area).IsOutput);
    }

    [Fact]
    public void Place_InANewTab_ReusesATabOfTheSameName()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Place(schema, new[] { Height },
            new LayoutPlacement.Target { NewTabLabel = " output ", NewGroupLabel = "Results" });

        Assert.Empty(outcome.Errors);
        Assert.Equal(2, Tabs(outcome.Schema).Count);
        Assert.Equal(new[] { Height }, Tabs(outcome.Schema)[1].Groups.Single().Items.Select(i => i.ParamId));
    }

    [Fact]
    public void Apply_RefusesASpecThatNamesTwoTabsAlike()
    {
        var outcome = LayoutSpec.Apply(LaidOut(), JObject.Parse("""
            { "tabs": [ { "label": "General", "groups": [] }, { "label": "general ", "groups": [] } ] }
            """));

        Assert.Null(outcome.Schema);
        Assert.Contains(outcome.Errors, e => e.Contains("unique"));
    }

    [Fact]
    public void Apply_RefusesTwoGroupsOfOneName_InOneTab_ButNotAcrossTabs()
    {
        var sameTab = LayoutSpec.Apply(LaidOut(), JObject.Parse("""
            { "tabs": [ { "label": "General", "groups": [ { "label": "Size", "items": [] }, { "label": "size", "items": [] } ] } ] }
            """));
        var acrossTabs = LayoutSpec.Apply(LaidOut(), JObject.Parse("""
            { "tabs": [ { "label": "General", "groups": [ { "label": "Size", "items": [] } ] },
                        { "label": "Output", "groups": [ { "label": "Size", "items": [] } ] } ] }
            """));

        Assert.Null(sameTab.Schema);
        Assert.Contains(sameTab.Errors, e => e.Contains("within a tab"));
        Assert.Empty(acrossTabs.Errors);
    }

    [Fact]
    public void NextFreeLabel_TakesTheFirstNumberNotInUse()
    {
        Assert.Equal("Tab 2", LayoutPlacement.NextFreeLabel(new[] { "tab 1", "Tab 3" }, "Tab"));
    }

    [Fact]
    public void Place_RefusesAnUnknownParam()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Place(schema, new[] { Guid.NewGuid() },
            new LayoutPlacement.Target { TabId = Tabs(schema)[0].Id, GroupId = Tabs(schema)[0].Groups[0].Id });

        Assert.Null(outcome.Schema);
        Assert.Single(outcome.Errors);
    }

    [Fact]
    public void Remove_DropsTheItems_KeepsParamsAndEmptyGroups()
    {
        var schema = LaidOut();

        var outcome = LayoutPlacement.Remove(schema, new[] { Width, Height });

        Assert.Equal(new[] { Width }, outcome.Removed);
        Assert.Empty(Tabs(outcome.Schema)[0].Groups[0].Items);
        Assert.Equal(2, Tabs(outcome.Schema)[0].Groups.Count);
        Assert.Contains(outcome.Schema.Inputs, i => i.Id == Width);
    }

    [Fact]
    public void Locations_NamesTabAndGroup()
    {
        var where = LayoutPlacement.Locations(LaidOut());

        Assert.Equal("General › Size", where[Width].Path);
        Assert.False(where.ContainsKey(Height));
    }
}
