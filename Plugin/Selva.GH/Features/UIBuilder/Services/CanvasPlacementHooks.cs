#nullable enable
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows.Forms;
using Grasshopper;
using Grasshopper.GUI;
using Grasshopper.GUI.Canvas;
using Grasshopper.GUI.Canvas.Interaction;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Special;
using Selva.Schema.Models;
using Selva.GH.Features.UIBuilder.Components;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     The canvas half of placing params into the form: Selva's lines in an object's right-click
///     menu, the tab under every object the form shows, and the canvas selection sent to an open
///     editor. Works on Rhino's and Hops' objects as well as Selva's, which is why none of it lives
///     in a component's own attributes. UI thread only.
/// </summary>
internal static class CanvasPlacementHooks
{
    private const string ShowPlacementSetting = "Selva.ShowUIPlacement";

    private static Guid _hovered = Guid.Empty;
    private static bool? _showPlacement;
    private static readonly ConditionalWeakTable<GH_UIBuilderComponent, string> LastSelectionSent =
        new ConditionalWeakTable<GH_UIBuilderComponent, string>();
    private static readonly ConditionalWeakTable<GH_UIBuilderComponent, PlacedCache> Placed =
        new ConditionalWeakTable<GH_UIBuilderComponent, PlacedCache>();

    // Read on every paint and mouse move, so the setting is cached here.
    public static bool ShowPlacement
    {
        get => _showPlacement ??= Instances.Settings.GetValue(ShowPlacementSetting, true);
        set
        {
            _showPlacement = value;
            Instances.Settings.SetValue(ShowPlacementSetting, value);
            Instances.ActiveCanvas?.Invalidate();
        }
    }

    public static void Register()
    {
        Instances.CanvasCreated += Attach;
        if (Instances.ActiveCanvas != null)
        {
            Attach(Instances.ActiveCanvas);
        }
    }

    private static void Attach(GH_Canvas canvas)
    {
        canvas.MouseDown -= OnMouseDown;
        canvas.MouseDown += OnMouseDown;
        canvas.MouseMove -= OnMouseMove;
        canvas.MouseMove += OnMouseMove;
        canvas.CanvasPostPaintObjects -= OnPostPaintObjects;
        canvas.CanvasPostPaintObjects += OnPostPaintObjects;
        canvas.CanvasPaintEnd -= OnPaintEnd;
        canvas.CanvasPaintEnd += OnPaintEnd;
    }

    // ============================================================================
    // What an object is to the form
    // ============================================================================

    private static bool IsSchemaBake(IGH_DocumentObject obj) =>
        obj is GH_Component c && ParameterTypeHelper.IsContextBakeComponent(c)
                              && c.Params.Input.Count > 0 && c.Params.Input[0].NickName == "Schema";

    /// <summary>A cheap type test for hover and right-click; the schema decides the rest.</summary>
    private static bool IsCandidate(IGH_DocumentObject obj) =>
        !IsSchemaBake(obj) && (obj is IGH_ContextualParameter
                               || ParameterTypeHelper.IsContextBakeComponent(obj)
                               || ParameterTypeHelper.IsContextOutputComponent(obj)
                               || CanvasPlacement.IsProducer(obj));

    private static IGH_DocumentObject? HitObject(GH_Canvas canvas, PointF point) =>
        canvas.Document?.FindAttribute(point, true)?.GetTopLevel?.DocObject;

    // FindAttribute does not return groups. Smallest first, so a nested group wins.
    private static GH_Group? HitGroup(GH_Canvas canvas, PointF point) =>
        canvas.Document?.Objects.OfType<GH_Group>()
            .Where(g => g.Attributes != null && g.Attributes.Bounds.Contains(point))
            .OrderBy(g => g.Attributes.Bounds.Width * g.Attributes.Bounds.Height)
            .FirstOrDefault();

    // ============================================================================
    // Right-click
    // ============================================================================

    // Grasshopper opens an object's menu from Canvas_MouseUp, after handing the release to the
    // active interaction. Replacing the pan interaction it starts on a right press makes Selva's
    // interaction receive the release, and Grasshopper's own menu code never runs. Any other
    // interaction means an object claimed the press or Ctrl is zooming: that gesture is left alone.
    // The object is picked as Grasshopper picks it, so a component's input or output grip keeps
    // that param's own menu.
    private static void OnMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button != MouseButtons.Right || sender is not GH_Canvas canvas || canvas.Document == null
            || canvas.ActiveInteraction is not GH_PanInteraction
            || CanvasPlacement.Bridges(canvas.Document).Count == 0)
        {
            return;
        }

        var point = canvas.Viewport.UnprojectPoint(e.Location);
        var attributes = canvas.Document.FindAttribute(point, false);
        IGH_DocumentObject? target = attributes != null
            ? attributes.IsMenuRegion(point) && IsCandidate(attributes.DocObject) ? attributes.DocObject : null
            : HitGroup(canvas, point);
        if (target != null)
        {
            canvas.ActiveInteraction = new MenuInteraction(canvas, new GH_CanvasMouseEvent(canvas.Viewport, e), target);
        }
    }

    private sealed class MenuInteraction : GH_AbstractInteraction
    {
        private readonly IGH_DocumentObject _target;
        private readonly Point _down;

        public MenuInteraction(GH_Canvas canvas, GH_CanvasMouseEvent e, IGH_DocumentObject target) : base(canvas, e)
        {
            _target = target;
            _down = e.ControlLocation;
        }

        // Right-drag pans: past a few pixels the gesture goes back to Grasshopper's pan.
        public override GH_ObjectResponse RespondToMouseMove(GH_Canvas sender, GH_CanvasMouseEvent e)
        {
            if (Math.Abs(e.ControlLocation.X - _down.X) + Math.Abs(e.ControlLocation.Y - _down.Y) > 4)
            {
                sender.ActiveInteraction = new GH_PanInteraction(sender, e);
            }

            return GH_ObjectResponse.Handled;
        }

        public override GH_ObjectResponse RespondToMouseUp(GH_Canvas sender, GH_CanvasMouseEvent e)
        {
            var menu = new ContextMenuStrip();
            try
            {
                (_target as GH_DocumentObject)?.AppendMenuItems(menu);
            }
            catch (Exception ex)
            {
                Utilities.Helpers.Logger.Error("Object menu failed", ex);
            }

            try
            {
                InsertSelvaItems(menu, sender.Document, _target);
            }
            catch (Exception ex)
            {
                Utilities.Helpers.Logger.Error("Canvas placement menu failed", ex);
            }

            if (menu.Items.Count > 0)
            {
                menu.Show(sender, e.ControlLocation);
            }

            sender.ActiveInteraction = null;
            return GH_ObjectResponse.Release;
        }
    }

    private static void InsertSelvaItems(ContextMenuStrip menu, GH_Document document, IGH_DocumentObject target)
    {
        var bridges = CanvasPlacement.Bridges(document);
        var group = target as GH_Group;
        var objects = group != null
            ? group.ObjectIDs.Select(id => document.FindObject(id, true)).Where(o => o != null).ToList()
            : target.Attributes.Selected
                ? document.SelectedObjects().Where(IsCandidate).ToList()
                : new List<IGH_DocumentObject> { target };

        var mine = new List<ToolStripItem>();
        foreach (var bridge in bridges)
        {
            var items = group != null ? GroupItems(bridge, group, objects) : ObjectItems(bridge, target, objects);
            if (items.Count == 0)
            {
                continue;
            }

            if (bridges.Count == 1)
            {
                mine.AddRange(items);
            }
            else
            {
                var perBridge = new ToolStripMenuItem(bridge.NickName);
                perBridge.DropDownItems.AddRange(items.ToArray());
                mine.Add(perBridge);
            }
        }

        if (mine.Count == 0)
        {
            return;
        }

        mine.Insert(0, new ToolStripSeparator());
        var enabled = menu.Items.Cast<ToolStripItem>().ToList().FindIndex(i => i.Text == "Enabled");
        var at = enabled >= 0 ? enabled + 1 : Math.Min(1, menu.Items.Count);
        for (var i = 0; i < mine.Count; i++)
        {
            menu.Items.Insert(at + i, mine[i]);
        }
    }

    // Selva's lines sit under Enabled, at most two: Rhino 8 on a Mac already scrolls a Get param's
    // menu, so anything appended at the end lands below the fold.
    private static List<ToolStripItem> ObjectItems(GH_UIBuilderComponent bridge, IGH_DocumentObject clicked,
        List<IGH_DocumentObject> objects)
    {
        var document = bridge.OnPingDocument();
        var schema = SchemaLayout.Synced(bridge, document);
        var ids = CanvasPlacement.Resolve(schema, objects);
        if (ids.Count == 0)
        {
            var reason = CanvasPlacement.IsProducer(clicked) && CanvasPlacement.DownstreamBakes(clicked).Count == 0
                ? "Wire into a Context Bake to add to the UI"
                : "Not in the UI yet: solve once";
            return new List<ToolStripItem> { new ToolStripMenuItem(reason) { Enabled = false } };
        }

        var locations = LayoutPlacement.Locations(schema);
        var placed = ids.Where(locations.ContainsKey).ToList();
        var allPlaced = placed.Count == ids.Count;
        var count = ids.Count > 1 ? ids.Count + " " : "";
        var items = new List<ToolStripItem>();

        if (CanvasPlacement.LastTargetOf(bridge) is { } last && FindGroup(schema, last.TabId, last.GroupId) is { } lastGroup
            && !ids.All(id => lastGroup.Group.Items.Any(i => i is not LineBreakLayoutItem && i.ParamId == id)))
        {
            items.Add(new ToolStripMenuItem($"{(allPlaced ? "Move" : "Add")} {count}to {Path(lastGroup.Tab, lastGroup.Group)}", null,
                (_, _) => CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { TabId = last.TabId, GroupId = last.GroupId })));
        }

        if (ids.Count == 1 && placed.Count == 1)
        {
            var at = new ToolStripMenuItem("UI: " + locations[ids[0]].Path);
            var moveTo = new ToolStripMenuItem("Move to");
            moveTo.DropDownItems.AddRange(TabsMenu(bridge, schema, ids, objects).ToArray());
            at.DropDownItems.Add(moveTo);
            at.DropDownItems.Add(new ToolStripMenuItem("Show in UI", null, (_, _) => CanvasPlacement.ShowInUI(bridge, ids[0])));
            at.DropDownItems.Add(new ToolStripSeparator());
            at.DropDownItems.Add(new ToolStripMenuItem("Remove from UI", null, (_, _) => CanvasPlacement.Remove(bridge, ids)));
            items.Add(at);
            return items;
        }

        var label = allPlaced
            ? $"Move {count}to"
            : CanvasPlacement.IsProducer(clicked) && objects.Count == 1
                ? $"Add \"{CanvasPlacement.Names(schema, ids)}\" to UI"
                : $"Add {count}to UI";
        if (!allPlaced && placed.Count > 0)
        {
            label += $" ({placed.Count} already in)";
        }

        var add = new ToolStripMenuItem(label);
        add.DropDownItems.AddRange(TabsMenu(bridge, schema, ids, objects).ToArray());
        if (placed.Count > 0)
        {
            add.DropDownItems.Add(new ToolStripSeparator());
            add.DropDownItems.Add(new ToolStripMenuItem("Remove from UI", null, (_, _) => CanvasPlacement.Remove(bridge, placed)));
        }

        items.Add(add);
        return items;
    }

    private static List<ToolStripItem> GroupItems(GH_UIBuilderComponent bridge, GH_Group group, List<IGH_DocumentObject> members)
    {
        var schema = SchemaLayout.Synced(bridge, bridge.OnPingDocument());
        var ids = CanvasPlacement.Resolve(schema, members);
        if (ids.Count == 0)
        {
            return new List<ToolStripItem>();
        }

        var name = string.IsNullOrWhiteSpace(group.NickName) ? "Group" : group.NickName.Trim();
        var publish = new ToolStripMenuItem($"Publish \"{name}\" to UI");
        var tabs = (schema.Layout as TabbedLayoutConfig)?.Tabs;
        if (tabs != null)
        {
            foreach (var tab in tabs)
            {
                var existing = tab.Groups.FirstOrDefault(g => string.Equals(g.Label, name, StringComparison.OrdinalIgnoreCase));
                var missing = existing == null ? ids.Count : ids.Count(id => existing.Items.All(i => i is LineBreakLayoutItem || i.ParamId != id));
                var hint = existing == null ? $"new group, {ids.Count}" : missing > 0 ? $"update, adds {missing}" : "up to date";
                publish.DropDownItems.Add(new ToolStripMenuItem($"{tab.Label}  ({hint})", null,
                    (_, _) => CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { TabId = tab.Id, NewGroupLabel = name }))
                {
                    Enabled = missing > 0
                });
            }

            publish.DropDownItems.Add(new ToolStripSeparator());
            publish.DropDownItems.Add(NewTabEntry(LayoutPlacement.NextFreeLabel(tabs.Select(t => t.Label), "Tab"), name, (tab, groupLabel) =>
                CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { NewTabLabel = tab, NewGroupLabel = groupLabel })));
        }
        else
        {
            publish.Click += (_, _) => CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { NewGroupLabel = name });
        }

        return new List<ToolStripItem> { publish };
    }

    /// <summary>The tabs, each opening its groups, then New tab… For a flat layout, the groups directly.</summary>
    private static List<ToolStripItem> TabsMenu(GH_UIBuilderComponent bridge, UISchema schema, List<Guid> ids,
        List<IGH_DocumentObject> objects)
    {
        var suggestion = SuggestedGroupName(bridge.OnPingDocument(), objects);
        var items = new List<ToolStripItem>();
        if (schema.Layout is TabbedLayoutConfig tabbed)
        {
            foreach (var tab in tabbed.Tabs)
            {
                var tabItem = new ToolStripMenuItem(tab.Label);
                tabItem.DropDownItems.AddRange(GroupsMenu(bridge, tab.Id, tab.Groups, ids, suggestion).ToArray());
                items.Add(tabItem);
            }

            items.Add(new ToolStripSeparator());
            items.Add(NewTabEntry(LayoutPlacement.NextFreeLabel(tabbed.Tabs.Select(t => t.Label), "Tab"), suggestion ?? "Group 1",
                (tab, groupLabel) => CanvasPlacement.Place(bridge, ids,
                    new LayoutPlacement.Target { NewTabLabel = tab, NewGroupLabel = groupLabel })));
        }
        else if (schema.Layout is FlatLayoutConfig flat)
        {
            items.AddRange(GroupsMenu(bridge, null, flat.Groups, ids, suggestion));
        }

        return items;
    }

    private static List<ToolStripItem> GroupsMenu(GH_UIBuilderComponent bridge, string? tabId, List<GroupConfig> groups,
        List<Guid> ids, string? suggestion)
    {
        var items = new List<ToolStripItem>();
        foreach (var group in groups)
        {
            var here = ids.Count(id => group.Items.Any(i => i is not LineBreakLayoutItem && i.ParamId == id));
            var item = new ToolStripMenuItem(group.Label, null,
                (_, _) => CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { TabId = tabId, GroupId = group.Id }))
            {
                Checked = ids.Count == 1 && here == 1
            };
            items.Add(item);
        }

        if (items.Count > 0)
        {
            items.Add(new ToolStripSeparator());
        }

        items.Add(TextEntry("New group…", suggestion ?? LayoutPlacement.NextFreeLabel(groups.Select(g => g.Label), "Group"), text =>
            CanvasPlacement.Place(bridge, ids, new LayoutPlacement.Target { TabId = tabId, NewGroupLabel = text })));
        return items;
    }

    // A menu text box, as the Get params' own At least… and At most… use; Enter commits.
    private static ToolStripMenuItem TextEntry(string label, string initial, Action<string> commit)
    {
        var item = new ToolStripMenuItem(label);
        GH_DocumentObject.Menu_AppendTextItem(item.DropDown, initial, (sender, e) =>
        {
            if (e.KeyCode != Keys.Enter || string.IsNullOrWhiteSpace(sender.Text))
            {
                return;
            }

            var text = sender.Text.Trim();
            sender.CloseEntireMenuStructure();
            commit(text);
        }, null, true);
        return item;
    }

    // A new tab needs a group to hold the params, so both are named here. Enter in either box or
    // Create commits, and an empty name commits nothing. No focus lock: GH_MenuTextBox's lock
    // gives each box its own Commit and Cancel lines, two pairs for one form.
    private static ToolStripMenuItem NewTabEntry(string initialTab, string initialGroup, Action<string, string> commit)
    {
        var item = new ToolStripMenuItem("New tab…");
        var drop = item.DropDown;
        ToolStripTextBox? tabBox = null;
        ToolStripTextBox? groupBox = null;

        bool TryCommit()
        {
            var tab = tabBox!.Text.Trim();
            var group = groupBox!.Text.Trim();
            if (tab.Length == 0 || group.Length == 0)
            {
                return false;
            }

            commit(tab, group);
            return true;
        }

        void OnKeyDown(GH_MenuTextBox sender, KeyEventArgs e)
        {
            if (e.KeyCode != Keys.Enter)
            {
                return;
            }

            e.SuppressKeyPress = true;
            if (TryCommit())
            {
                sender.CloseEntireMenuStructure();
            }
        }

        drop.Items.Add(new ToolStripLabel("Tab name"));
        tabBox = GH_DocumentObject.Menu_AppendTextItem(drop, initialTab, OnKeyDown, null, false);
        drop.Items.Add(new ToolStripLabel("Group name"));
        groupBox = GH_DocumentObject.Menu_AppendTextItem(drop, initialGroup, OnKeyDown, null, false);
        drop.Items.Add(new ToolStripSeparator());
        drop.Items.Add(new ToolStripMenuItem("Create", null, (_, _) => TryCommit()));
        return item;
    }

    // The name of the Grasshopper group every one of the objects sits in, if there is one.
    private static string? SuggestedGroupName(GH_Document? document, List<IGH_DocumentObject> objects)
    {
        if (document == null || objects.Count == 0)
        {
            return null;
        }

        var ids = new HashSet<Guid>(objects.Select(o => o.InstanceGuid));
        return document.Objects.OfType<GH_Group>()
            .Where(g => !string.IsNullOrWhiteSpace(g.NickName) && ids.All(g.ObjectIDs.Contains))
            .OrderBy(g => g.ObjectIDs.Count)
            .Select(g => g.NickName.Trim())
            .FirstOrDefault();
    }

    private static (TabConfig? Tab, GroupConfig Group)? FindGroup(UISchema schema, string? tabId, string groupId)
    {
        switch (schema.Layout)
        {
            case TabbedLayoutConfig tabbed:
                var tab = tabbed.Tabs.FirstOrDefault(t => t.Id == tabId);
                var inTab = tab?.Groups.FirstOrDefault(g => g.Id == groupId);
                return inTab != null ? (tab, inTab) : null;
            case FlatLayoutConfig flat:
                var group = flat.Groups.FirstOrDefault(g => g.Id == groupId);
                return group != null ? (null, group) : null;
            default:
                return null;
        }
    }

    private static string Path(TabConfig? tab, GroupConfig group) => tab == null ? group.Label : tab.Label + " › " + group.Label;

    // ============================================================================
    // The placement tab and hover
    // ============================================================================

    private static void OnMouseMove(object? sender, MouseEventArgs e)
    {
        if (sender is not GH_Canvas canvas || canvas.Document == null || !ShowPlacement)
        {
            return;
        }

        var obj = HitObject(canvas, canvas.Viewport.UnprojectPoint(e.Location));
        var id = obj != null && IsCandidate(obj) && !CanvasPlacement.IsProducer(obj) ? obj.InstanceGuid : Guid.Empty;
        if (id != _hovered)
        {
            _hovered = id;
            canvas.Invalidate();
        }
    }

    // Drawn with Grasshopper's own message renderer, the routine behind a component's Message,
    // so shape, font and the shoulders that join it to the object match exactly. Always the
    // neutral palette: taking the object's would turn it red on an error and green on selection.
    private static void OnPostPaintObjects(GH_Canvas canvas)
    {
        var document = canvas.Document;
        if (document == null || !ShowPlacement)
        {
            return;
        }

        var bridges = CanvasPlacement.Bridges(document);
        if (bridges.Count == 0)
        {
            return;
        }

        var locations = new Dictionary<Guid, LayoutPlacement.Location>();
        var unsaved = new HashSet<Guid>();
        foreach (var bridge in bridges)
        {
            ShownLocations(bridge, locations, unsaved);
        }

        var style = GH_CapsuleRenderEngine.GetImpliedStyle(GH_Palette.Normal, false, false, false);
        foreach (var obj in document.Objects)
        {
            var placed = locations.TryGetValue(obj.InstanceGuid, out var location);
            var hovered = obj.InstanceGuid == _hovered;
            var changed = unsaved.Contains(obj.InstanceGuid);
            if ((!placed && !hovered && !changed) || obj.Attributes == null || obj is GH_Component { Message: { Length: > 0 } })
            {
                continue;
            }

            var bounds = obj.Attributes.Bounds;
            if (!canvas.Viewport.IsVisible(ref bounds, 20))
            {
                continue;
            }

            // The object's body: without a Get param's pointed end or a component's zigzag edge.
            // The box never grows to fit the text, or the tab's shoulders end up in empty canvas.
            bounds = obj.Attributes.Bounds;
            var box = new RectangleF(bounds.Left, bounds.Top, bounds.Width - (obj is IGH_Param ? 12f : 6f), bounds.Height);
            bool Fits(string text) => GH_FontServer.StringWidth(text, GH_FontServer.StandardAdjusted) + 24f <= box.Width;

            // A trailing * marks a placement the editor has changed and not saved yet.
            var mark = changed ? "*" : "";
            var label = placed
                ? (hovered && Fits(location!.Path + mark) ? location.Path : location!.GroupLabel) + mark
                : (Fits("Not in UI" + mark) ? "Not in UI" : "–") + mark;

            using var capsule = GH_Capsule.CreateCapsule(box, GH_Palette.Normal);
            capsule.RenderEngine.RenderMessage(canvas.Graphics, label, style);
        }
    }

    // What the canvas shows for one bridge: the open editor's draft while it has unsaved changes,
    // else the saved layout. A param whose place differs from the saved one, or that the draft
    // took out, goes into unsaved.
    private static void ShownLocations(GH_UIBuilderComponent bridge, Dictionary<Guid, LayoutPlacement.Location> shown,
        HashSet<Guid> unsaved)
    {
        var saved = LocationsOf(bridge);
        var draft = bridge.Transport != null ? bridge.DraftLocations : null;
        foreach (var pair in draft ?? saved)
        {
            shown[pair.Key] = pair.Value;
            if (draft != null && (!saved.TryGetValue(pair.Key, out var before) || before.Path != pair.Value.Path))
            {
                unsaved.Add(pair.Key);
            }
        }

        if (draft != null)
        {
            unsaved.UnionWith(saved.Keys.Where(id => !draft.ContainsKey(id)));
        }
    }

    private sealed class PlacedCache
    {
        public UISchema? Schema;
        public int ItemCount = -1;
        public Dictionary<Guid, LayoutPlacement.Location> Locations = new Dictionary<Guid, LayoutPlacement.Location>();
    }

    // Rebuilt when the bridge holds a different schema or its item count changes: validation adds
    // and drops items in place, while a relabel only arrives with a new schema from a save.
    private static Dictionary<Guid, LayoutPlacement.Location> LocationsOf(GH_UIBuilderComponent bridge)
    {
        var cache = Placed.GetValue(bridge, _ => new PlacedCache());
        var schema = bridge.Schema;
        var count = schema?.Layout == null ? 0 : SchemaSynchronizer.GetAllLayoutItems(schema.Layout).Count();
        if (!ReferenceEquals(cache.Schema, schema) || cache.ItemCount != count)
        {
            cache.Schema = schema;
            cache.ItemCount = count;
            cache.Locations = schema == null ? new Dictionary<Guid, LayoutPlacement.Location>() : LayoutPlacement.Locations(schema);
        }

        return cache.Locations;
    }

    // ============================================================================
    // Canvas selection, for the editor's tray
    // ============================================================================

    // Grasshopper raises no selection event; a selection change repaints, so paint end is where
    // it shows. Each bridge hears only when the ids it resolves change, which also covers a
    // selected object becoming publishable after a solve. An editor that connects later is sent
    // the selection with its initial data.
    private static void OnPaintEnd(GH_Canvas canvas)
    {
        var document = canvas.Document;
        if (document == null)
        {
            return;
        }

        List<IGH_DocumentObject>? selected = null;
        foreach (var bridge in CanvasPlacement.Bridges(document))
        {
            if (bridge.Transport is not { } transport || bridge.Schema == null)
            {
                continue;
            }

            selected ??= document.SelectedObjects();
            var ids = CanvasPlacement.Resolve(bridge.Schema, selected);
            var key = string.Join(",", ids);
            if (LastSelectionSent.TryGetValue(bridge, out var last) && last == key)
            {
                continue;
            }

            LastSelectionSent.AddOrUpdate(bridge, key);
            _ = transport.BroadcastCanvasSelection(ids);
        }
    }

    // ============================================================================
    // The UI Bridge's own menu
    // ============================================================================

    /// <summary>
    ///     "Add selection to UI", for the bridge's menu: the same placement, reached without
    ///     right-clicking the objects themselves.
    /// </summary>
    public static ToolStripMenuItem SelectionMenu(GH_UIBuilderComponent bridge)
    {
        var document = bridge.OnPingDocument();
        var objects = document?.SelectedObjects().Where(IsCandidate).ToList() ?? new List<IGH_DocumentObject>();
        var schema = document != null && objects.Count > 0 ? SchemaLayout.Synced(bridge, document) : null;
        var ids = schema != null ? CanvasPlacement.Resolve(schema, objects) : new List<Guid>();
        var item = new ToolStripMenuItem(ids.Count > 0 ? $"Add selection to UI ({ids.Count})" : "Add selection to UI")
        {
            Enabled = ids.Count > 0,
            ToolTipText = ids.Count > 0 ? null : "Select inputs or outputs on the canvas first"
        };
        if (schema != null && ids.Count > 0)
        {
            item.DropDownItems.AddRange(TabsMenu(bridge, schema, ids, objects).ToArray());
        }

        return item;
    }
}
