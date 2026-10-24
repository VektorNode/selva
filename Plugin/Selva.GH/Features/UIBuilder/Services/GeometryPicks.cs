using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Rhino;
using Rhino.Commands;
using Rhino.Geometry;
using Selva.GH.Config;
using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>The answer to one pick: `picked` with a summary, `cancelled`, or `failed` with a reason.</summary>
public sealed class GeometryPickOutcome
{
    private GeometryPickOutcome(string kind, string summary, string error)
    {
        Kind = kind;
        Summary = summary;
        Error = error;
    }

    public string Kind { get; }
    public string Summary { get; }
    public string Error { get; }

    public static GeometryPickOutcome Picked(string summary) => new GeometryPickOutcome("picked", summary, null);
    public static readonly GeometryPickOutcome Cancelled = new GeometryPickOutcome("cancelled", null, null);
    public static GeometryPickOutcome Failed(string error) => new GeometryPickOutcome("failed", null, error);
}

/// <summary>
///     Geometry picked in the Rhino viewport for a geometry input. The geometry lives on the param
///     as contextual data; this remembers which params hold a pick, so the bridge's post-solve
///     clear leaves them alone, and what to show for each.
/// </summary>
/// <remarks>
///     Nothing on the page resends a pick, unlike typed values, which is why picked params are
///     exempt from that clear. Grasshopper never writes contextual data into the .gh, so a pick
///     ends with the session. UI thread only.
/// </remarks>
public sealed class GeometryPicks
{
    private readonly Dictionary<Guid, string> _summaries = new Dictionary<Guid, string>();

    public bool IsPicked(Guid paramId) => _summaries.ContainsKey(paramId);

    public string SummaryOf(Guid paramId) => _summaries.TryGetValue(paramId, out var summary) ? summary : null;

    /// <summary>
    ///     The param prompts on Rhino's command line with its own filter, prompt and count, inside a
    ///     command the way Grasshopper Player asks for it. Blocks until the user picks or presses Esc.
    /// </summary>
    public GeometryPickOutcome Pick(GH_Document document, Guid paramId)
    {
        if (!(document?.FindObject(paramId, false) is IGH_ContextualParameter param))
        {
            return GeometryPickOutcome.Failed("That input is no longer in the definition.");
        }

        var rhinoDoc = RhinoDoc.ActiveDoc;
        if (rhinoDoc == null)
        {
            return GeometryPickOutcome.Failed("No Rhino document is open to pick from.");
        }

        if (!ModalGate.Shared.TryEnter())
        {
            return GeometryPickOutcome.Failed("Rhino is already asking for something. Finish or cancel that first.");
        }

        var name = (param as IGH_DocumentObject)?.NickName ?? "Geometry";
        var assigned = false;
        try
        {
            RhinoCommandContext.Run(() =>
                assigned = param.AutoAssignContextualData(new GH_ParameterContext(name, rhinoDoc, RunMode.Interactive)));
        }
        finally
        {
            ModalGate.Shared.Exit();
        }

        if (!assigned)
        {
            return GeometryPickOutcome.Cancelled;
        }

        var picked = param.ContextualData?.ToList() ?? new List<object>();
        if (picked.Count == 0)
        {
            return GeometryPickOutcome.Cancelled;
        }

        if (!ScheduleExpire(document, param))
        {
            return GeometryPickOutcome.Failed("That input can't be picked into.");
        }

        var summary = Summarize(picked);
        _summaries[paramId] = summary;
        return GeometryPickOutcome.Picked(summary);
    }

    /// <summary>The param goes back to the definition's own geometry.</summary>
    /// <returns>True when a solve was scheduled for it.</returns>
    public bool Clear(GH_Document document, Guid paramId)
    {
        if (!_summaries.Remove(paramId) ||
            !(document?.FindObject(paramId, false) is IGH_ContextualParameter param))
        {
            return false;
        }

        ParameterTypeHelper.TryInvokeClearContextualData(param);
        return ScheduleExpire(document, param);
    }

    /// <summary>The session ended; the component clears every contextual param itself.</summary>
    public void Forget()
    {
        _summaries.Clear();
    }

    private static bool ScheduleExpire(GH_Document document, IGH_ContextualParameter param)
    {
        if (!(param is IGH_ActiveObject active))
        {
            return false;
        }

        document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs,
            _ => active.ExpireSolution(false));
        return true;
    }

    /// <summary>"2 curves", "1 point", "3 objects" when the kinds differ.</summary>
    internal static string Summarize(IReadOnlyCollection<object> picked)
    {
        var kinds = picked.Select(KindOf).Distinct().ToList();
        var (singular, plural) = kinds.Count == 1 ? kinds[0] : ("object", "objects");
        return picked.Count == 1 ? $"1 {singular}" : $"{picked.Count} {plural}";
    }

    // ContextualData hands back Rhino's own types (LineCurve, Point3d), so name them the way
    // Rhino's command line does.
    private static (string Singular, string Plural) KindOf(object item)
    {
        switch (item)
        {
            case Point3d _:
            case Point _:
                return ("point", "points");
            case Line _:
                return ("line", "lines");
            case Plane _:
                return ("plane", "planes");
            case Curve _:
                return ("curve", "curves");
            case Brep brep:
                return brep.Faces.Count == 1 ? ("surface", "surfaces") : ("polysurface", "polysurfaces");
            case Extrusion _:
                return ("extrusion", "extrusions");
            case Surface _:
                return ("surface", "surfaces");
            case Mesh _:
                return ("mesh", "meshes");
            case SubD _:
                return ("SubD", "SubDs");
            case PointCloud _:
                return ("point cloud", "point clouds");
            default:
                return ("object", "objects");
        }
    }
}
