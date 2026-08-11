using System;
using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.Tests;

/// <summary>
///     Tests for LayoutTombstoneStore — recovery of layout items when a deleted parameter comes
///     back via undo.
///
///     Covers a data-loss path reproduced against a live Grasshopper session: deleting a getter
///     dropped its widget and any group/tab it emptied, and undo re-added only the parameter. Four
///     configured output widgets and their whole group were unrecoverable, and the loss persisted
///     to disk.
/// </summary>
public class LayoutTombstoneStoreTests
{
    private static readonly Guid ParamA = new Guid("11111111-0000-0000-0000-000000000001");
    private static readonly Guid ParamB = new Guid("11111111-0000-0000-0000-000000000002");

    private static LayoutItemBase Item(string id, Guid paramId, string display = null) =>
        new InputNumberLayoutItem { Id = id, ParamId = paramId, DisplayName = display };

    private static UISchema Schema(params LayoutItemBase[] items)
    {
        return new UISchema
        {
            Id = "s",
            Name = "Schema",
            Layout = new TabbedLayoutConfig
            {
                Tabs =
                [
                    new TabConfig
                    {
                        Id = "tab-1", Label = "Main",
                        Groups = [new GroupConfig { Id = "grp-1", Label = "Dims", Items = [.. items] }]
                    }
                ]
            }
        };
    }

    private static List<LayoutItemBase> ItemsOf(UISchema schema) =>
        ((TabbedLayoutConfig)schema.Layout).Tabs.SelectMany(t => t.Groups).SelectMany(g => g.Items).ToList();

    private static void AddInput(UISchema schema, Guid id) =>
        schema.Inputs.Add(new SchemaInput { Id = id, Nickname = "p", ParamType = "number" });

    // -------------------------------------------------------------------------
    // Capture + restore
    // -------------------------------------------------------------------------

    [Fact]
    public void CaptureAndRemove_RemovesItemWhoseParamIsGone()
    {
        var schema = Schema(Item("i1", ParamA), Item("i2", ParamB));
        var store = new LayoutTombstoneStore();

        store.CaptureAndRemove(schema.Layout, [ParamB]);

        Assert.Equal(1, store.Count);
        Assert.Equal(["i2"], ItemsOf(schema).Select(i => i.Id));
    }

    [Fact]
    public void TryRestore_PutsTheItemBackAtItsOriginalIndex()
    {
        var schema = Schema(Item("i1", ParamA), Item("i2", ParamB));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, [ParamB]);

        Assert.True(store.TryRestore(schema, ParamA));

        // Index preserved: the restored item leads again, rather than being appended.
        Assert.Equal(["i1", "i2"], ItemsOf(schema).Select(i => i.Id));
        Assert.Equal(0, store.Count);
    }

    [Fact]
    public void TryRestore_PreservesTheConfiguredWidget()
    {
        // The whole point: the widget type and its display name survive, not just the param id.
        var schema = Schema(Item("i1", ParamA, "Width"));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);

        store.TryRestore(schema, ParamA);

        var restored = ItemsOf(schema).Single();
        Assert.IsType<InputNumberLayoutItem>(restored);
        Assert.Equal("Width", restored.DisplayName);
    }

    [Fact]
    public void TryRestore_UnknownParam_ReturnsFalse()
    {
        var schema = Schema(Item("i1", ParamA));

        Assert.False(new LayoutTombstoneStore().TryRestore(schema, ParamB));
    }

    [Fact]
    public void TryRestore_IsIdempotent()
    {
        var schema = Schema(Item("i1", ParamA));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);

        Assert.True(store.TryRestore(schema, ParamA));
        Assert.False(store.TryRestore(schema, ParamA));
        Assert.Single(ItemsOf(schema));
    }

    // -------------------------------------------------------------------------
    // Emptied containers — the destructive case
    // -------------------------------------------------------------------------

    [Fact]
    public void CaptureAndRemove_KeepsAnEmptiedGroupAndTab()
    {
        // Previously the group and tab were dropped once the last item left, so undo had nowhere
        // to put the widget back.
        var schema = Schema(Item("i1", ParamA));
        var store = new LayoutTombstoneStore();

        store.CaptureAndRemove(schema.Layout, []);

        var tabbed = (TabbedLayoutConfig)schema.Layout;
        Assert.Single(tabbed.Tabs);
        Assert.Single(tabbed.Tabs[0].Groups);
        Assert.Empty(tabbed.Tabs[0].Groups[0].Items);
    }

    [Fact]
    public void TryRestore_RecreatesTheGroupWhenItIsGone()
    {
        var schema = Schema(Item("i1", ParamA));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);

        // Simulate the group having been removed by something else.
        ((TabbedLayoutConfig)schema.Layout).Tabs[0].Groups.Clear();

        Assert.True(store.TryRestore(schema, ParamA));

        var group = ((TabbedLayoutConfig)schema.Layout).Tabs.Single().Groups.Single();
        Assert.Equal("grp-1", group.Id);
        Assert.Equal("Dims", group.Label);
        Assert.Equal("i1", group.Items.Single().Id);
    }

    [Fact]
    public void TryRestore_RecreatesTheTabWhenItIsGone()
    {
        var schema = Schema(Item("i1", ParamA));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);
        ((TabbedLayoutConfig)schema.Layout).Tabs.Clear();

        Assert.True(store.TryRestore(schema, ParamA));

        var tab = ((TabbedLayoutConfig)schema.Layout).Tabs.Single();
        Assert.Equal("tab-1", tab.Id);
        Assert.Equal("Main", tab.Label);
        Assert.Equal("i1", tab.Groups.Single().Items.Single().Id);
    }

    [Fact]
    public void FullGroupWipe_RoundTrips()
    {
        // The live repro: every item in a group deleted at once, then undone.
        var schema = Schema(Item("i1", ParamA), Item("i2", ParamB));
        var store = new LayoutTombstoneStore();

        store.CaptureAndRemove(schema.Layout, []);
        Assert.Empty(ItemsOf(schema));

        AddInput(schema, ParamA);
        AddInput(schema, ParamB);
        foreach (var id in schema.Inputs.Select(i => i.Id).ToList()) store.TryRestore(schema, id);

        Assert.Equal(["i1", "i2"], ItemsOf(schema).Select(i => i.Id));
    }

    // -------------------------------------------------------------------------
    // Parameter ordering — keeps SchemaHash stable across delete+undo
    // -------------------------------------------------------------------------

    [Fact]
    public void TryRestore_PutsTheParameterBackAtItsOriginalIndex()
    {
        // The merge steps append, so without index restoration a delete+undo reorders Inputs,
        // changing SchemaHash and invalidating every open editor's save base.
        var schema = Schema(Item("i1", ParamA), Item("i2", ParamB));
        AddInput(schema, ParamA);
        AddInput(schema, ParamB);

        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, [ParamB],
            new Dictionary<Guid, int> { [ParamA] = 0, [ParamB] = 1 });

        // Simulate purge + re-append, which is what the synchronizer does.
        schema.Inputs.RemoveAll(i => i.Id == ParamA);
        AddInput(schema, ParamA);
        Assert.Equal([ParamB, ParamA], schema.Inputs.Select(i => i.Id));

        store.TryRestore(schema, ParamA);

        Assert.Equal([ParamA, ParamB], schema.Inputs.Select(i => i.Id));
    }

    [Fact]
    public void TryRestore_WithoutIndexInfo_LeavesOrderAlone()
    {
        var schema = Schema(Item("i1", ParamA));
        AddInput(schema, ParamB);
        AddInput(schema, ParamA);

        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);

        store.TryRestore(schema, ParamA);

        Assert.Equal([ParamB, ParamA], schema.Inputs.Select(i => i.Id));
    }

    // -------------------------------------------------------------------------
    // Linebreaks and authoritative saves
    // -------------------------------------------------------------------------

    [Fact]
    public void CaptureAndRemove_LeavesLinebreaksAlone()
    {
        // Linebreaks carry no ParamId, so they must never be matched against the document.
        var schema = Schema(new LineBreakLayoutItem { Id = "lb" }, Item("i1", ParamA));
        var store = new LayoutTombstoneStore();

        store.CaptureAndRemove(schema.Layout, []);

        Assert.Equal(["lb"], ItemsOf(schema).Select(i => i.Id));
        Assert.Equal(1, store.Count);
    }

    [Fact]
    public void ForgetAllExcept_DropsWidgetsTheEditorNoLongerPlaces()
    {
        // A save is the user's intent: a widget they deliberately removed must not spring back.
        var schema = Schema(Item("i1", ParamA), Item("i2", ParamB));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);
        Assert.Equal(2, store.Count);

        store.ForgetAllExcept([ParamA]);

        Assert.Equal(1, store.Count);
        Assert.True(store.TryRestore(schema, ParamA));
        Assert.False(store.TryRestore(schema, ParamB));
    }

    [Fact]
    public void Forget_DropsNamedTombstones()
    {
        var schema = Schema(Item("i1", ParamA));
        var store = new LayoutTombstoneStore();
        store.CaptureAndRemove(schema.Layout, []);

        store.Forget([ParamA]);

        Assert.Equal(0, store.Count);
        Assert.False(store.TryRestore(schema, ParamA));
    }

    [Fact]
    public void CaptureAndRemove_FlatLayout_IsSupported()
    {
        var schema = new UISchema
        {
            Id = "s", Name = "Schema",
            Layout = new FlatLayoutConfig
            {
                Groups = [new GroupConfig { Id = "g", Label = "G", Items = [Item("i1", ParamA)] }]
            }
        };
        var store = new LayoutTombstoneStore();

        store.CaptureAndRemove(schema.Layout, []);
        Assert.Empty(((FlatLayoutConfig)schema.Layout).Groups[0].Items);

        Assert.True(store.TryRestore(schema, ParamA));
        Assert.Equal("i1", ((FlatLayoutConfig)schema.Layout).Groups[0].Items.Single().Id);
    }
}
