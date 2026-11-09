using System;
using System.Collections.Generic;
using System.Linq;
using Selva.GH.Features.UIBuilder.Services.Schema;
using Selva.Schema.Models;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Which file components a preview solve may skip: those whose every downstream path ends at a
///     Context Bake the page shows only as a Download button. Rhino-free;
///     <see cref="PreviewDeferralReader" /> builds the graph from a document.
/// </summary>
/// <remarks>
///     Every miss errs toward making the file. A file feeding anything else (an image widget's
///     bake, a size readout, a Merge, another file component, a dangling relay) or feeding nothing
///     is made every solve: skipping it would blank something, or skip a side effect. Walking
///     upstream from the Download bakes can't see such a second recipient, so the walk goes
///     downstream from each file component.
/// </remarks>
public static class PreviewDeferral
{
    public enum NodeKind
    {
        FileComponent,

        /// <summary>A floating param: relay, Param_FileData, a param painter. Forwards its data.</summary>
        Relay,
        ContextBake,
        Other
    }

    public sealed class Graph
    {
        private readonly Dictionary<Guid, (NodeKind Kind, string Name)> _nodes =
            new Dictionary<Guid, (NodeKind, string)>();

        private readonly Dictionary<Guid, List<Guid>> _recipients = new Dictionary<Guid, List<Guid>>();
        private readonly List<Guid> _order = new List<Guid>();

        /// <param name="downloadBakes">Bakes the layout shows only as a Download button.</param>
        public Graph(IEnumerable<Guid> downloadBakes)
        {
            DownloadBakes = new HashSet<Guid>(downloadBakes ?? Enumerable.Empty<Guid>());
        }

        public HashSet<Guid> DownloadBakes { get; }

        public Graph Add(Guid id, NodeKind kind, string name)
        {
            if (!_nodes.ContainsKey(id))
            {
                _order.Add(id);
            }

            _nodes[id] = (kind, name);
            return this;
        }

        /// <summary>Data leaving <paramref name="from" /> reaches an input of <paramref name="to" />.</summary>
        public Graph Wire(Guid from, Guid to)
        {
            if (!_recipients.TryGetValue(from, out var list))
            {
                _recipients[from] = list = new List<Guid>();
            }

            if (!list.Contains(to))
            {
                list.Add(to);
            }

            return this;
        }

        internal IEnumerable<Guid> FileComponents =>
            _order.Where(id => _nodes[id].Kind == NodeKind.FileComponent);

        internal IReadOnlyList<Guid> RecipientsOf(Guid id) =>
            _recipients.TryGetValue(id, out var list) ? list : (IReadOnlyList<Guid>)Array.Empty<Guid>();

        // A recipient the document didn't report as a node (inside a cluster, say) is some other
        // component: it reads the data, so it blocks.
        internal (NodeKind Kind, string Name) Node(Guid id) =>
            _nodes.TryGetValue(id, out var node) ? node : (NodeKind.Other, "a component");
    }

    public sealed class Plan
    {
        /// <summary>The schema didn't opt in to preview solves, or there is no schema.</summary>
        public static readonly Plan Off = new Plan(false, new HashSet<Guid>(), new List<Guid>(),
            new Dictionary<Guid, string>());

        internal Plan(bool enabled, HashSet<Guid> fileComponents, List<Guid> bakes,
            Dictionary<Guid, string> reasons)
        {
            Enabled = enabled;
            FileComponents = fileComponents;
            Bakes = bakes;
            Reasons = reasons;
        }

        /// <summary>The schema asks for preview solves. A preview can be on with nothing to defer.</summary>
        public bool Enabled { get; }

        public HashSet<Guid> FileComponents { get; }

        /// <summary>The Download bakes the deferred components feed: the outcome's <c>deferred</c> ids.</summary>
        public List<Guid> Bakes { get; }

        /// <summary>For a file component that feeds a Download but is made every solve: why.</summary>
        public Dictionary<Guid, string> Reasons { get; }

        public bool Defers(Guid fileComponent) => FileComponents.Contains(fileComponent);

        /// <summary>Formatted as <c>schema.outputs[].id</c> is written, so the UI can match them as strings.</summary>
        public List<string> DeferredOutputIds() => Bakes.Select(id => id.ToString()).ToList();
    }

    /// <summary>
    ///     Null unless the schema opts in. A bake counts only when every layout item showing it is a
    ///     Download: the same bake also shown as an image would go blank.
    /// </summary>
    public static HashSet<Guid> DownloadBakes(UISchema schema)
    {
        if (schema?.PreviewSolves != true)
        {
            return null;
        }

        var downloads = new HashSet<Guid>();
        var shownOtherwise = new HashSet<Guid>();
        foreach (var item in SchemaOutputCanonicalizer.GetAllLayoutItems(schema.Layout))
        {
            if (item == null || item.ParamId == Guid.Empty)
            {
                continue;
            }

            (item is OutputFileLayoutItem ? downloads : shownOtherwise).Add(item.ParamId);
        }

        downloads.ExceptWith(shownOtherwise);
        return downloads;
    }

    public static Plan Decide(Graph graph)
    {
        var deferred = new HashSet<Guid>();
        var bakes = new List<Guid>();
        var reasons = new Dictionary<Guid, string>();

        foreach (var file in graph.FileComponents)
        {
            var ends = Ends(graph, file);
            var blockers = ends.Where(e => !graph.DownloadBakes.Contains(e)).ToList();

            if (ends.Count > 0 && blockers.Count == 0)
            {
                deferred.Add(file);
                bakes.AddRange(ends.Where(b => !bakes.Contains(b)));
                continue;
            }

            if (ends.Count > blockers.Count)
            {
                reasons[file] = $"also feeds {Names(graph, blockers)}";
            }
            else if (ReachesDownload(graph, file))
            {
                reasons[file] = $"reaches its Download through {Names(graph, blockers)}";
            }
        }

        return new Plan(true, deferred, bakes, reasons);
    }

    // Through anything, components included: only for telling the author why a file behind a Merge
    // is made every solve, never for deciding it may skip.
    private static bool ReachesDownload(Graph graph, Guid file)
    {
        var visited = new HashSet<Guid> { file };
        var pending = new Queue<Guid>(graph.RecipientsOf(file));
        while (pending.Count > 0)
        {
            var id = pending.Dequeue();
            if (!visited.Add(id)) continue;
            if (graph.DownloadBakes.Contains(id)) return true;
            foreach (var recipient in graph.RecipientsOf(id))
            {
                pending.Enqueue(recipient);
            }
        }

        return false;
    }

    /// <summary>Where the file's data stops: the first non-relay on every path, or a relay with no recipient.</summary>
    private static List<Guid> Ends(Graph graph, Guid file)
    {
        var ends = new List<Guid>();
        var visited = new HashSet<Guid> { file };
        var pending = new Stack<Guid>(graph.RecipientsOf(file));

        while (pending.Count > 0)
        {
            var id = pending.Pop();
            if (!visited.Add(id))
            {
                continue;
            }

            var next = graph.Node(id).Kind == NodeKind.Relay ? graph.RecipientsOf(id) : null;
            if (next == null || next.Count == 0)
            {
                ends.Add(id);
                continue;
            }

            foreach (var recipient in next)
            {
                pending.Push(recipient);
            }
        }

        return ends;
    }

    private static string Names(Graph graph, List<Guid> blockers)
    {
        var names = blockers
            .Select(id => graph.Node(id))
            .Select(n => n.Kind == NodeKind.ContextBake ? $"{n.Name} (not a Download)" : n.Name)
            .Distinct()
            .ToList();
        var shown = string.Join(", ", names.Take(3));
        return names.Count > 3 ? $"{shown} and {names.Count - 3} more" : shown;
    }
}
