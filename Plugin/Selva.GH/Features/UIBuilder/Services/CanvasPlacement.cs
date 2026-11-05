#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using Grasshopper.Kernel;
using Rhino;
using Selva.Schema.Models;
using Selva.FileIO;
using Selva.GH.Features.ComputeIO.Components;
using Selva.GH.Features.UIBuilder.Components;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Features.UIBuilder.Services.Schema;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Placing canvas objects into a bridge's form. Resolves what was clicked to the ids the schema
///     keys on, applies the change through the bridge's commit, and tells the command line and any
///     open editor. UI thread only.
/// </summary>
internal static class CanvasPlacement
{
    // Keyed by the bridge object, not its InstanceGuid: a pasted or reopened bridge shares the id
    // but not this session's last target, and the entry goes with the bridge.
    private static readonly ConditionalWeakTable<GH_UIBuilderComponent, StrongBox<(string? TabId, string GroupId)>> LastTarget =
        new ConditionalWeakTable<GH_UIBuilderComponent, StrongBox<(string? TabId, string GroupId)>>();

    public static List<GH_UIBuilderComponent> Bridges(GH_Document? document) =>
        document?.Objects.OfType<GH_UIBuilderComponent>().ToList() ?? new List<GH_UIBuilderComponent>();

    /// <summary>
    ///     The ids <paramref name="schema" /> keys these objects on, in canvas order. An output is its
    ///     Context Bake, never the component feeding it, so a Set Dynamic Value List or a file
    ///     component resolves to the bakes it is wired into.
    /// </summary>
    public static List<Guid> Resolve(UISchema schema, IEnumerable<IGH_DocumentObject> objects)
    {
        var inputs = new HashSet<Guid>((schema.Inputs ?? new List<SchemaInput>()).Select(i => i.Id));
        var outputs = new HashSet<Guid>((schema.Outputs ?? new List<SchemaOutput>()).Select(o => o.Id));
        var result = new List<Guid>();
        foreach (var obj in objects.OrderBy(o => o.Attributes?.Pivot.Y ?? 0).ThenBy(o => o.Attributes?.Pivot.X ?? 0))
        {
            if (inputs.Contains(obj.InstanceGuid) || outputs.Contains(obj.InstanceGuid))
            {
                result.Add(obj.InstanceGuid);
            }
            else if (IsProducer(obj))
            {
                result.AddRange(DownstreamBakes(obj).Select(b => b.InstanceGuid).Where(outputs.Contains));
            }
        }

        return result.Distinct().ToList();
    }

    public static bool IsProducer(IGH_DocumentObject obj) => obj is GH_DynamicValueListOutput or ISelvaFileOutput;

    /// <summary>
    ///     Context Bakes fed by a producer, through relays and floating params. A producer is a
    ///     component, or a param such as File Data that feeds bakes itself.
    /// </summary>
    public static List<GH_Component> DownstreamBakes(IGH_DocumentObject producer)
    {
        var bakes = new List<GH_Component>();
        var visited = new HashSet<Guid>();
        var pending = producer switch
        {
            IGH_Component component => new Stack<IGH_Param>(component.Params.Output),
            IGH_Param param => new Stack<IGH_Param>(new[] { param }),
            _ => new Stack<IGH_Param>()
        };
        while (pending.Count > 0)
        {
            var param = pending.Pop();
            foreach (var recipient in param.Recipients)
            {
                if (!visited.Add(recipient.InstanceGuid))
                {
                    continue;
                }

                var owner = recipient.Attributes?.GetTopLevel?.DocObject;
                if (owner is GH_Component component && ParameterTypeHelper.IsContextBakeComponent(component))
                {
                    if (!bakes.Contains(component))
                    {
                        bakes.Add(component);
                    }
                }
                else if (owner == recipient)
                {
                    pending.Push(recipient);
                }
            }
        }

        return bakes;
    }

    public static (string? TabId, string GroupId)? LastTargetOf(GH_UIBuilderComponent bridge) =>
        LastTarget.TryGetValue(bridge, out var target) ? target.Value : null;

    public static void Place(GH_UIBuilderComponent bridge, IReadOnlyList<Guid> ids, LayoutPlacement.Target target)
    {
        var document = bridge.OnPingDocument();
        if (document == null || ids.Count == 0)
        {
            return;
        }

        var synced = SchemaLayout.Synced(bridge, document);
        var outcome = LayoutPlacement.Place(synced, ids, target, (id, widget) => SchemaLayout.CanvasConfig(document, id, widget));
        if (outcome.Schema == null)
        {
            RhinoApp.WriteLine("Selva: could not place: " + string.Join("; ", outcome.Errors));
            return;
        }

        var placed = outcome.Placed.FirstOrDefault();
        if (placed == null)
        {
            RhinoApp.WriteLine("Selva: already there.");
            return;
        }

        LastTarget.AddOrUpdate(bridge, new StrongBox<(string? TabId, string GroupId)>((placed.TabId, placed.GroupId)));
        var where = placed.TabLabel == null ? placed.GroupLabel : placed.TabLabel + " › " + placed.GroupLabel;
        var summary = Summary(outcome.Schema, outcome.Added, outcome.Moved) + " to " + where;
        Commit(bridge, outcome.Schema, "Add to UI", outcome.Placed, new List<Guid>(), summary);
    }

    public static void Remove(GH_UIBuilderComponent bridge, IReadOnlyList<Guid> ids)
    {
        var document = bridge.OnPingDocument();
        if (document == null || bridge.Schema == null || ids.Count == 0)
        {
            return;
        }

        var outcome = LayoutPlacement.Remove(SchemaLayout.Synced(bridge, document), ids);
        if (outcome.Removed.Count == 0)
        {
            return;
        }

        var summary = "Removed " + Names(outcome.Schema!, outcome.Removed) + " from the form";
        Commit(bridge, outcome.Schema!, "Remove from UI", new List<LayoutPlacement.Placed>(), outcome.Removed, summary);
    }

    public static void ShowInUI(GH_UIBuilderComponent bridge, Guid id)
    {
        bridge.OpenUIInPanel();
        _ = bridge.Transport?.BroadcastRevealItem(id);
    }

    public static string Names(UISchema schema, IEnumerable<Guid> ids)
    {
        var names = ids.Select(id => schema.Inputs?.FirstOrDefault(i => i.Id == id)?.Nickname
                                     ?? schema.Outputs?.FirstOrDefault(o => o.Id == id)?.Nickname
                                     ?? "?").ToList();
        return names.Count <= 3 ? string.Join(", ", names) : $"{names.Count} items";
    }

    private static string Summary(UISchema schema, List<Guid> added, List<Guid> moved)
    {
        if (moved.Count == 0)
        {
            return "Added " + Names(schema, added);
        }

        return added.Count == 0
            ? "Moved " + Names(schema, moved)
            : "Added " + Names(schema, added) + ", moved " + Names(schema, moved);
    }

    private static void Commit(GH_UIBuilderComponent bridge, UISchema schema, string undoName,
        List<LayoutPlacement.Placed> placed, List<Guid> removed, string summary)
    {
        bridge.CommitAuthoredSchema(schema, undoName,
            committed => _ = bridge.Transport?.BroadcastLayoutPlaced(committed, placed, removed, summary));
        RhinoApp.WriteLine("Selva: " + summary + ".");
        Grasshopper.Instances.ActiveCanvas?.Invalidate();
    }
}
