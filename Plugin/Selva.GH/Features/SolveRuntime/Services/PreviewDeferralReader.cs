using System;
using System.Linq;
using Grasshopper.Kernel;
using Selva.FileIO;
using Selva.GH.Features.UIBuilder.Components;
using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>Builds <see cref="PreviewDeferral.Graph" /> from a document's wiring and its embedded schema.</summary>
public static class PreviewDeferralReader
{
    public static PreviewDeferral.Plan Read(GH_Document document)
    {
        // Two schemas could disagree on what is a Download, so only a single one counts.
        var schemas = document?.Objects.OfType<GH_UIBuilderComponent>()
            .Select(b => b.Schema)
            .Where(s => s != null)
            .Take(2)
            .ToList();
        if (schemas == null || schemas.Count != 1)
        {
            return PreviewDeferral.Plan.Off;
        }

        var downloads = PreviewDeferral.DownloadBakes(schemas[0]);
        if (downloads == null)
        {
            return PreviewDeferral.Plan.Off;
        }

        var graph = new PreviewDeferral.Graph(downloads);
        foreach (var obj in document.Objects)
        {
            switch (obj)
            {
                case IGH_Param param:
                    graph.Add(param.InstanceGuid, PreviewDeferral.NodeKind.Relay, param.NickName);
                    WireRecipients(graph, param.InstanceGuid, param);
                    break;
                case IGH_Component component:
                    graph.Add(component.InstanceGuid, Kind(component), Name(component));
                    foreach (var output in component.Params.Output)
                    {
                        WireRecipients(graph, component.InstanceGuid, output);
                    }

                    break;
            }
        }

        return PreviewDeferral.Decide(graph);
    }

    private static PreviewDeferral.NodeKind Kind(IGH_Component component)
    {
        if (ParameterTypeHelper.IsContextBakeComponent(component))
        {
            return PreviewDeferral.NodeKind.ContextBake;
        }

        // OBSOLETE_ snapshots keep their released SolveInstance and never skip, so they can't defer.
        return component is ISelvaFileOutput
               && !component.GetType().Name.StartsWith("OBSOLETE_", StringComparison.Ordinal)
            ? PreviewDeferral.NodeKind.FileComponent
            : PreviewDeferral.NodeKind.Other;
    }

    // A bake's own nickname is "Context Bake"; its input's nickname is the output's name.
    private static string Name(IGH_Component component) =>
        ParameterTypeHelper.IsContextBakeComponent(component) && component.Params.Input.Count > 0
            ? component.Params.Input[0].NickName
            : component.NickName;

    private static void WireRecipients(PreviewDeferral.Graph graph, Guid from, IGH_Param output)
    {
        foreach (var recipient in output.Recipients)
        {
            var owner = recipient?.Attributes?.GetTopLevel?.DocObject ?? recipient;
            if (owner != null)
            {
                graph.Wire(from, owner.InstanceGuid);
            }
        }
    }
}
