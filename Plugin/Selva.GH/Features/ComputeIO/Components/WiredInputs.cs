using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     The Selva inputs wired to a param, found through relays. A definition laid out in sections
///     carries a wire into another section through a plain floating param, so the direct neighbour is
///     often the relay, not the input.
/// </summary>
internal static class WiredInputs
{
    /// <summary>The inputs wired into <paramref name="input" />.</summary>
    public static List<IGH_Param> Find(IGH_Param input)
    {
        var found = new List<IGH_Param>();
        Walk(input, p => p.Sources, found, new HashSet<Guid>());
        return found;
    }

    /// <summary>The inputs <paramref name="output" /> feeds.</summary>
    public static List<IGH_Param> Fed(IGH_Param output)
    {
        var found = new List<IGH_Param>();
        Walk(output, p => p.Recipients, found, new HashSet<Guid>());
        return found;
    }

    /// <summary>
    ///     True when <paramref name="source" />'s data reaches <paramref name="component" />, through any
    ///     number of components and relays.
    /// </summary>
    public static bool FeedsComponent(IGH_DocumentObject source, IGH_Component component)
    {
        var visited = new HashSet<Guid>();
        var pending = new Stack<IGH_Param>(component.Params.Input);
        while (pending.Count > 0)
        {
            foreach (var upstream in pending.Pop().Sources)
            {
                if (upstream == null || !visited.Add(upstream.InstanceGuid))
                {
                    continue;
                }

                if (upstream.InstanceGuid == source.InstanceGuid)
                {
                    return true;
                }

                var owner = upstream.Attributes?.GetTopLevel?.DocObject;
                if (owner is IGH_Component producer && !ReferenceEquals(owner, upstream))
                {
                    foreach (var input in producer.Params.Input)
                    {
                        pending.Push(input);
                    }
                }
                else
                {
                    pending.Push(upstream);
                }
            }
        }

        return false;
    }

    /// <summary>A text tree's items in flattened order, nulls skipped.</summary>
    public static List<string> Strings(GH_Structure<GH_String> tree)
    {
        return tree == null
            ? new List<string>()
            : tree.AllData(true).OfType<GH_String>().Select(s => s.Value).ToList();
    }

    private static void Walk(IGH_Param param, Func<IGH_Param, IList<IGH_Param>> next, List<IGH_Param> found,
        HashSet<Guid> visited)
    {
        foreach (var neighbour in next(param))
        {
            if (neighbour == null || !visited.Add(neighbour.InstanceGuid))
            {
                continue;
            }

            if (neighbour is IGH_ContextualParameter)
            {
                found.Add(neighbour);
                continue;
            }

            // A floating param only relays; a component's param is where the wire ends.
            var owner = neighbour.Attributes?.GetTopLevel?.DocObject;
            if (owner == null || ReferenceEquals(owner, neighbour))
            {
                Walk(neighbour, next, found, visited);
            }
        }
    }
}
