using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel;
using Rhino;
using Rhino.Commands;
using Rhino.Geometry;
using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>The answer to one pick: picked with a summary, cancelled, or failed with a reason.</summary>
public sealed class GeometryPickOutcome
{
    private GeometryPickOutcome(PromptOutcome kind, string summary, string error)
    {
        Kind = kind;
        Summary = summary;
        Error = error;
    }

    public PromptOutcome Kind { get; }
    public string Summary { get; }
    public string Error { get; }

    public static GeometryPickOutcome Picked(string summary) =>
        new GeometryPickOutcome(PromptOutcome.Picked, summary, null);

    public static readonly GeometryPickOutcome Cancelled = new GeometryPickOutcome(PromptOutcome.Cancelled, null, null);

    public static GeometryPickOutcome Failed(string error) => new GeometryPickOutcome(PromptOutcome.Failed, null, error);
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
    private Guid _picking;

    /// <summary>
    ///     The post-solve clear skips these: params holding a pick, and the one being picked now.
    ///     Rhino's Get Geometry solves after each selection while its prompt is still open, and
    ///     clearing it then empties the list its prompt loop counts: the loop never finishes, and
    ///     with the selection still preselected it solves again at once, without end.
    /// </summary>
    public bool KeepsContextualData(Guid paramId) => paramId == _picking || _summaries.ContainsKey(paramId);

    public string SummaryOf(Guid paramId) => _summaries.TryGetValue(paramId, out var summary) ? summary : null;

    /// <summary>
    ///     The param prompts on Rhino's command line with its own filter, prompt and count, inside a
    ///     command the way Grasshopper Player asks for it. Blocks until the user picks or presses Esc.
    ///     The caller holds <see cref="ModalGate.Shared" />.
    /// </summary>
    /// <param name="scheduleDelayMs">How long the solve after a pick waits to start.</param>
    public GeometryPickOutcome Pick(GH_Document document, Guid paramId, int scheduleDelayMs)
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

        var name = (param as IGH_DocumentObject)?.NickName ?? "Geometry";
        var assigned = false;
        _picking = paramId;
        try
        {
            RhinoCommandContext.Run(() =>
                assigned = param.AutoAssignContextualData(new GH_ParameterContext(name, rhinoDoc, RunMode.Interactive)));
        }
        finally
        {
            _picking = Guid.Empty;
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

        if (!ScheduleExpire(document, param, scheduleDelayMs))
        {
            return GeometryPickOutcome.Failed("That input can't be picked into.");
        }

        var summary = PickSummary.Of(picked.Select(KindOf).ToList());
        _summaries[paramId] = summary;
        return GeometryPickOutcome.Picked(summary);
    }

    /// <summary>The param goes back to the definition's own geometry.</summary>
    /// <returns>True when a solve was scheduled for it.</returns>
    public bool Clear(GH_Document document, Guid paramId, int scheduleDelayMs)
    {
        if (!_summaries.Remove(paramId) ||
            !(document?.FindObject(paramId, false) is IGH_ContextualParameter param))
        {
            return false;
        }

        ParameterTypeHelper.TryInvokeClearContextualData(param);
        return ScheduleExpire(document, param, scheduleDelayMs);
    }

    /// <summary>The session ended; the component clears every contextual param itself.</summary>
    public void Forget()
    {
        _summaries.Clear();
    }

    private static bool ScheduleExpire(GH_Document document, IGH_ContextualParameter param, int scheduleDelayMs)
    {
        if (!(param is IGH_ActiveObject active))
        {
            return false;
        }

        document.ScheduleSolution(scheduleDelayMs, _ => active.ExpireSolution(false));
        return true;
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
