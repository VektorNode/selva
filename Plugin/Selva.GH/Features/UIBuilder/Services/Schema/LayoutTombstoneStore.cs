using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Where a layout item sat before its parameter was deleted from the document: enough to put
///     it back in the same tab, group and slot.
/// </summary>
public sealed class LayoutTombstone
{
    public LayoutItemBase Item { get; set; }
    public string TabId { get; set; }
    public string TabLabel { get; set; }
    public string GroupId { get; set; }
    public string GroupLabel { get; set; }
    public int ItemIndex { get; set; }

    /// <summary>
    ///     Position in schema.Inputs/Outputs before the purge. The merge steps append, so without
    ///     this an undone deletion reorders the list — which changes SchemaHash and invalidates
    ///     every open editor's save base for a round trip that should be a no-op.
    /// </summary>
    public int ParamIndex { get; set; } = -1;
}

/// <summary>
///     Remembers layout items whose parameter left the document, so undoing that deletion restores
///     the widget and not just the parameter.
///
///     Deleting a getter used to drop its layout item and cascade away any group and tab it
///     emptied. Undo re-adds the parameter (MergeDiscoveredInputs) but knows nothing about layout,
///     so the widget, its display name and its placement were gone for good — and the loss
///     persisted to disk.
///
///     Keyed on the parameter's InstanceGuid, which Grasshopper preserves across delete/undo.
///     A copy-paste gets a fresh Guid, so a tombstone can never be resurrected onto the wrong
///     object.
///
///     Deliberately not part of UISchema: this is recovery state for a live editing session, not
///     document content. Keeping it out means no ui-schema.json regen and no SchemaHash
///     perturbation, at the cost of tombstones not surviving a reload — which still covers the
///     delete-then-undo window this exists for.
/// </summary>
public class LayoutTombstoneStore
{
    private readonly Dictionary<Guid, LayoutTombstone> _tombstones = new Dictionary<Guid, LayoutTombstone>();

    public int Count => _tombstones.Count;

    public void Clear() => _tombstones.Clear();

    /// <summary>
    ///     Records every layout item whose parameter is no longer in the document, and removes it
    ///     from the layout. Groups and tabs left empty are kept — dropping them is what turned a
    ///     recoverable deletion into a destroyed tab.
    /// </summary>
    public void CaptureAndRemove(LayoutConfigBase layout, HashSet<Guid> existingIds,
        IReadOnlyDictionary<Guid, int> paramIndices = null)
    {
        foreach (var (tab, group) in EnumerateContainers(layout))
        {
            for (var i = group.Items.Count - 1; i >= 0; i--)
            {
                var item = group.Items[i];
                if (item.Type == "linebreak" || existingIds.Contains(item.ParamId))
                {
                    continue;
                }

                _tombstones[item.ParamId] = new LayoutTombstone
                {
                    Item = item,
                    TabId = tab?.Id,
                    TabLabel = tab?.Label,
                    GroupId = group.Id,
                    GroupLabel = group.Label,
                    ItemIndex = i,
                    ParamIndex = paramIndices != null && paramIndices.TryGetValue(item.ParamId, out var pi) ? pi : -1
                };

                group.Items.RemoveAt(i);
            }
        }
    }

    /// <summary>
    ///     Puts back the layout item for a parameter that returned to the document. Returns true if
    ///     a tombstone was consumed. Re-creates the group (and tab) if the user deleted those too.
    /// </summary>
    public bool TryRestore(UISchema schema, Guid paramId)
    {
        if (!_tombstones.TryGetValue(paramId, out var tombstone))
        {
            return false;
        }

        _tombstones.Remove(paramId);

        RestoreParamOrder(schema.Inputs, paramId, tombstone.ParamIndex);
        RestoreParamOrder(schema.Outputs, paramId, tombstone.ParamIndex);

        var group = FindOrCreateGroup(schema.Layout, tombstone);
        if (group == null)
        {
            return false;
        }

        if (group.Items.Any(i => i.Type != "linebreak" && i.ParamId == paramId))
        {
            return true;
        }

        var index = Math.Min(Math.Max(tombstone.ItemIndex, 0), group.Items.Count);
        group.Items.Insert(index, tombstone.Item);
        return true;
    }

    /// <summary>
    ///     Drops tombstones the user has decided against — called when a save arrives from the
    ///     editor, whose layout is authoritative. Without this a deliberate "remove this widget"
    ///     would spring back the next time the parameter was rediscovered.
    /// </summary>
    public void Forget(IEnumerable<Guid> paramIds)
    {
        foreach (var id in paramIds)
        {
            _tombstones.Remove(id);
        }
    }

    public void ForgetAllExcept(HashSet<Guid> keep)
    {
        foreach (var id in _tombstones.Keys.Where(k => !keep.Contains(k)).ToList())
        {
            _tombstones.Remove(id);
        }
    }

    /// <summary>
    ///     Moves a re-appended parameter back to the slot it held before deletion, so a
    ///     delete-then-undo leaves the schema byte-identical.
    /// </summary>
    private static void RestoreParamOrder<T>(List<T> list, Guid paramId, int index) where T : class
    {
        if (list == null || index < 0) return;

        var current = list.FindIndex(x => IdOf(x) == paramId);
        if (current < 0 || current == index) return;

        var item = list[current];
        list.RemoveAt(current);
        list.Insert(Math.Min(index, list.Count), item);
    }

    private static Guid IdOf(object param) => param switch
    {
        SchemaInput i => i.Id,
        SchemaOutput o => o.Id,
        _ => Guid.Empty
    };

    private static GroupConfig FindOrCreateGroup(LayoutConfigBase layout, LayoutTombstone tombstone)
    {
        foreach (var (_, group) in EnumerateContainers(layout))
        {
            if (group.Id == tombstone.GroupId)
            {
                return group;
            }
        }

        var restored = new GroupConfig
        {
            Id = tombstone.GroupId,
            Label = tombstone.GroupLabel,
            Items = []
        };

        switch (layout)
        {
            case TabbedLayoutConfig tabbed:
                var tab = tabbed.Tabs?.FirstOrDefault(t => t.Id == tombstone.TabId);
                if (tab == null)
                {
                    if (tabbed.Tabs == null) return null;
                    tab = new TabConfig { Id = tombstone.TabId, Label = tombstone.TabLabel, Groups = [] };
                    tabbed.Tabs.Add(tab);
                }

                tab.Groups.Add(restored);
                return restored;

            case FlatLayoutConfig flat:
                if (flat.Groups == null) return null;
                flat.Groups.Add(restored);
                return restored;

            default:
                return null;
        }
    }

    private static IEnumerable<(TabConfig Tab, GroupConfig Group)> EnumerateContainers(LayoutConfigBase layout)
    {
        switch (layout)
        {
            case TabbedLayoutConfig tabbed when tabbed.Tabs != null:
                foreach (var tab in tabbed.Tabs)
                {
                    if (tab?.Groups == null) continue;
                    foreach (var group in tab.Groups)
                    {
                        if (group?.Items != null) yield return (tab, group);
                    }
                }
                break;

            case FlatLayoutConfig flat when flat.Groups != null:
                foreach (var group in flat.Groups)
                {
                    if (group?.Items != null) yield return (null, group);
                }
                break;
        }
    }
}
