using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Puts params into a tab and group of the form, or takes them out, for the canvas menus. A
///     param shows once in the form, so placing one that sits elsewhere moves it, keeping its
///     label and config. Works on <see cref="LayoutSpec" />'s Read/Apply round trip, so a new item
///     gets the widget and canvas config a scripted layout would give it. Rhino-free.
/// </summary>
public static class LayoutPlacement
{
    public sealed class Placed
    {
        public Guid ParamId { get; set; }
        public bool IsOutput { get; set; }

        /// <summary>Null on a flat layout.</summary>
        public string TabId { get; set; }

        public string TabLabel { get; set; }
        public string GroupId { get; set; }
        public string GroupLabel { get; set; }
    }

    /// <summary>
    ///     An existing tab by <see cref="TabId" />, or one named <see cref="NewTabLabel" />: tab
    ///     names are unique, so a tab of that name already (case-insensitive) is reused.
    ///     An existing group by <see cref="GroupId" />, or one named <see cref="NewGroupLabel" />:
    ///     a group of that name in the tab already (case-insensitive) is reused rather than doubled.
    /// </summary>
    public sealed class Target
    {
        public string TabId { get; set; }
        public string NewTabLabel { get; set; }
        public string GroupId { get; set; }
        public string NewGroupLabel { get; set; }
    }

    public sealed class Outcome
    {
        /// <summary>The changed copy; null when <see cref="Errors" /> has any.</summary>
        public UISchema Schema { get; internal set; }

        public List<string> Errors { get; } = new List<string>();
        public List<Placed> Placed { get; } = new List<Placed>();
        public List<Guid> Added { get; } = new List<Guid>();
        public List<Guid> Moved { get; } = new List<Guid>();
        public List<Guid> Removed { get; } = new List<Guid>();
    }

    public sealed class Location
    {
        public string TabId { get; set; }
        public string TabLabel { get; set; }
        public string GroupId { get; set; }
        public string GroupLabel { get; set; }

        public string Path => TabLabel == null ? GroupLabel : TabLabel + " › " + GroupLabel;
    }

    /// <summary>Where each placed param sits, keyed by param id.</summary>
    public static Dictionary<Guid, Location> Locations(UISchema schema)
    {
        var map = new Dictionary<Guid, Location>();
        foreach (var (tab, group, _, item) in Items(schema?.Layout))
        {
            if (item is LineBreakLayoutItem || map.ContainsKey(item.ParamId))
            {
                continue;
            }

            map[item.ParamId] = new Location
            {
                TabId = tab?.Id,
                TabLabel = tab?.Label,
                GroupId = group.Id,
                GroupLabel = group.Label
            };
        }

        return map;
    }

    /// <param name="paramIds">Inputs and outputs of <paramref name="current" />, in the order they should appear.</param>
    /// <param name="canvasConfig">As for <see cref="LayoutSpec.Apply" />.</param>
    public static Outcome Place(UISchema current, IReadOnlyList<Guid> paramIds, Target target,
        Func<Guid, string, JObject> canvasConfig = null)
    {
        var outcome = new Outcome();
        if (current?.Layout == null)
        {
            outcome.Errors.Add("The schema has no layout.");
            return outcome;
        }

        var outputs = new HashSet<Guid>((current.Outputs ?? new List<SchemaOutput>()).Select(o => o.Id));
        var known = new HashSet<Guid>((current.Inputs ?? new List<SchemaInput>()).Select(i => i.Id).Concat(outputs));
        foreach (var id in paramIds.Where(id => !known.Contains(id)))
        {
            outcome.Errors.Add($"{id} is not an input or output of this definition.");
        }

        if (outcome.Errors.Count > 0)
        {
            return outcome;
        }

        // Read mirrors the layout one to one, so a spec item sits at the same indices as its
        // layout item; that is how a moved item carries its label and config along.
        var spec = LayoutSpec.Read(current);
        var tabbed = current.Layout is TabbedLayoutConfig;
        var specTabs = tabbed ? (JArray)spec["tabs"] : null;

        var tabIndex = -1;
        if (tabbed)
        {
            var tabs = ((TabbedLayoutConfig)current.Layout).Tabs;
            tabIndex = target.TabId != null ? tabs.FindIndex(t => t.Id == target.TabId) : -1;
            if (tabIndex < 0)
            {
                if (string.IsNullOrWhiteSpace(target.NewTabLabel))
                {
                    outcome.Errors.Add($"No tab {target.TabId}.");
                    return outcome;
                }

                var label = target.NewTabLabel.Trim();
                tabIndex = tabs.FindIndex(t => SameLabel(t.Label, label));
                if (tabIndex < 0)
                {
                    specTabs.Add(new JObject { ["label"] = label, ["groups"] = new JArray() });
                    tabIndex = specTabs.Count - 1;
                }
            }
        }

        var specGroups = tabbed ? (JArray)specTabs[tabIndex]["groups"] : (JArray)spec["groups"];
        var groupIndex = FindGroup(current, tabbed ? tabIndex : -1, target, specGroups);
        if (groupIndex < 0)
        {
            if (string.IsNullOrWhiteSpace(target.NewGroupLabel))
            {
                outcome.Errors.Add($"No group {target.GroupId}.");
                return outcome;
            }

            specGroups.Add(new JObject { ["label"] = target.NewGroupLabel.Trim(), ["items"] = new JArray() });
            groupIndex = specGroups.Count - 1;
        }

        var positions = Items(current.Layout)
            .Where(x => x.Item is not LineBreakLayoutItem)
            .GroupBy(x => x.Item.ParamId)
            .ToDictionary(g => g.Key, g => g.First());

        var appended = new List<Guid>();
        var removals = new List<(JArray Items, int Index)>();
        var newItems = new List<JToken>();
        foreach (var id in paramIds.Distinct())
        {
            if (positions.TryGetValue(id, out var at))
            {
                var tabAt = tabbed ? ((TabbedLayoutConfig)current.Layout).Tabs.IndexOf(at.Tab) : -1;
                var groupAt = tabbed ? at.Tab.Groups.IndexOf(at.Group) : ((FlatLayoutConfig)current.Layout).Groups.IndexOf(at.Group);
                if (tabAt == tabIndex && groupAt == groupIndex)
                {
                    continue;
                }

                var sourceItems = (JArray)(tabbed ? specTabs[tabAt]["groups"] : spec["groups"])[groupAt]["items"];
                newItems.Add(sourceItems[at.Index].DeepClone());
                removals.Add((sourceItems, at.Index));
                outcome.Moved.Add(id);
            }
            else
            {
                newItems.Add(new JObject { ["paramId"] = id.ToString() });
                outcome.Added.Add(id);
            }

            appended.Add(id);
        }

        foreach (var (items, index) in removals.OrderByDescending(r => r.Index))
        {
            items.RemoveAt(index);
        }

        var targetItems = (JArray)specGroups[groupIndex]["items"];
        foreach (var item in newItems)
        {
            targetItems.Add(item);
        }

        var applied = LayoutSpec.Apply(current, spec, canvasConfig);
        if (applied.Schema == null)
        {
            outcome.Errors.AddRange(applied.Errors);
            return outcome;
        }

        TabConfig resultTab = null;
        GroupConfig resultGroup;
        if (applied.Schema.Layout is TabbedLayoutConfig resultTabbed)
        {
            resultTab = resultTabbed.Tabs[tabIndex];
            resultGroup = resultTab.Groups[groupIndex];
        }
        else
        {
            resultGroup = ((FlatLayoutConfig)applied.Schema.Layout).Groups[groupIndex];
        }

        outcome.Placed.AddRange(appended.Select(id => new Placed
        {
            ParamId = id,
            IsOutput = outputs.Contains(id),
            TabId = resultTab?.Id,
            TabLabel = resultTab?.Label,
            GroupId = resultGroup.Id,
            GroupLabel = resultGroup.Label
        }));
        outcome.Schema = applied.Schema;
        return outcome;
    }

    /// <summary>
    ///     Takes the params' items out of the layout. The params stay in schema.inputs/outputs, and a
    ///     group or tab left empty stays: dropping it silently is how a tab gets lost.
    /// </summary>
    public static Outcome Remove(UISchema current, IReadOnlyList<Guid> paramIds)
    {
        var outcome = new Outcome();
        var schema = LayoutSpec.Clone(current);
        var ids = new HashSet<Guid>(paramIds);
        foreach (var (_, group, _, _) in Items(schema.Layout).ToList())
        {
            var before = group.Items.Where(i => i is not LineBreakLayoutItem && ids.Contains(i.ParamId)).Select(i => i.ParamId).ToList();
            if (before.Count == 0)
            {
                continue;
            }

            group.Items.RemoveAll(i => i is not LineBreakLayoutItem && ids.Contains(i.ParamId));
            outcome.Removed.AddRange(before.Where(id => !outcome.Removed.Contains(id)));
        }

        outcome.Schema = schema;
        return outcome;
    }

    /// <summary><paramref name="stem" /> 1, 2… the first not in <paramref name="taken" />, as the editor names a new tab or group.</summary>
    public static string NextFreeLabel(IEnumerable<string> taken, string stem)
    {
        var used = new HashSet<string>(taken.Where(t => t != null).Select(t => t.Trim()), StringComparer.OrdinalIgnoreCase);
        var n = 1;
        while (used.Contains($"{stem} {n}"))
        {
            n++;
        }

        return $"{stem} {n}";
    }

    internal static bool SameLabel(string a, string b) =>
        string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    private static int FindGroup(UISchema current, int tabIndex, Target target, JArray specGroups)
    {
        var groups = tabIndex >= 0
            ? (tabIndex < ((TabbedLayoutConfig)current.Layout).Tabs.Count ? ((TabbedLayoutConfig)current.Layout).Tabs[tabIndex].Groups : new List<GroupConfig>())
            : ((FlatLayoutConfig)current.Layout).Groups;
        if (target.GroupId != null)
        {
            var byId = groups.FindIndex(g => g.Id == target.GroupId);
            if (byId >= 0)
            {
                return byId;
            }
        }

        if (string.IsNullOrWhiteSpace(target.NewGroupLabel))
        {
            return -1;
        }

        var label = target.NewGroupLabel.Trim();
        for (var i = 0; i < specGroups.Count; i++)
        {
            if (string.Equals((string)specGroups[i]["label"], label, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        return -1;
    }

    private static IEnumerable<(TabConfig Tab, GroupConfig Group, int Index, LayoutItemBase Item)> Items(LayoutConfigBase layout)
    {
        IEnumerable<(TabConfig, GroupConfig)> groups = layout switch
        {
            TabbedLayoutConfig tabbed => (tabbed.Tabs ?? new List<TabConfig>())
                .SelectMany(t => (t.Groups ?? new List<GroupConfig>()).Select(g => (t, g))),
            FlatLayoutConfig flat => (flat.Groups ?? new List<GroupConfig>()).Select(g => ((TabConfig)null, g)),
            _ => Enumerable.Empty<(TabConfig, GroupConfig)>()
        };

        foreach (var (tab, group) in groups)
        {
            var items = group.Items ?? new List<LayoutItemBase>();
            for (var i = 0; i < items.Count; i++)
            {
                yield return (tab, group, i, items[i]);
            }
        }
    }
}
