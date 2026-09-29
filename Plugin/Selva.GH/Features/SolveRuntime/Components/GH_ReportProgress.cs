using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.SolveRuntime.Services;

namespace Selva.GH.Features.SolveRuntime.Components;

/// <summary>
///     Names the step that is about to run, so the web UI can show it and a progress bar while
///     the solve is still going.
/// </summary>
/// <remarks>
///     Wired inline, before the step: the step asks for its input, Grasshopper solves this first,
///     so the report lands just before the step starts. Grasshopper solves one component at a
///     time, so the latest report is always what is running. The fraction is not the author's:
///     <see cref="StepProgress" /> derives it from which reporters run this solution.
/// </remarks>
public class GH_ReportProgress : GH_Component
{
    private const string DefaultMessage = "Working…";

    public GH_ReportProgress()
        : base("Report Progress", "Progress",
            "Shows a message and a progress bar in the web UI while the solve runs. Wire Data " +
            "through it into the step it describes; the bar fills as the reporters run.",
            "Selva", "Utilities")
    {
    }

    public override Guid ComponentGuid => new Guid("C8B23E4E-8093-406C-B859-3EBA38A2BCD6");

    protected override Bitmap Icon => null;

    // It passes geometry through, so by default Grasshopper would preview it a second time, and
    // meshing Breps for that preview blocks Rhino's UI thread for seconds after every solve.
    public override bool IsPreviewCapable => false;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Data", "D",
            "Passed through unchanged. It decides when this reports: right before whatever " +
            "consumes the output.", GH_ParamAccess.tree);
        pManager.AddTextParameter("Message", "M",
            "Shown in the web UI while the next step runs, e.g. \"Calculating Voronoi cells…\".",
            GH_ParamAccess.tree);

        // An empty branch is how this learns its step is skipped; Grasshopper must still run it.
        Params.Input[0].Optional = true;
        Params.Input[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Data", "D", "The input, unchanged.", GH_ParamAccess.tree);
    }

    public override void AddedToDocument(GH_Document document)
    {
        base.AddedToDocument(document);
        // The runtime counts the expected reporters at SolutionStart, which it only hears if it
        // exists before the first solution does.
        SolveRuntimes.For(document);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        DA.GetDataTree(0, out GH_Structure<IGH_Goo> data);
        DA.GetDataTree(1, out GH_Structure<GH_String> messages);
        DA.SetDataTree(0, data);

        var message = DefaultMessage;
        if (messages != null && messages.DataCount > 0 && messages.get_FirstItem(true) is GH_String first
            && !string.IsNullOrWhiteSpace(first.Value))
        {
            message = first.Value.Trim();
        }

        Message = message;

        // Unwired, nothing orders this against the step, so it reports whenever Grasshopper
        // happens to reach it.
        if (Params.Input[0].SourceCount == 0 || Params.Output[0].Recipients.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Wire Data through this component into the step it describes, so it reports " +
                "right before that step runs.");
        }

        var skipped = Params.Input[0].SourceCount > 0 && (data == null || data.DataCount == 0);
        SolveRuntimes.For(OnPingDocument())?.ReportStep(InstanceGuid, message, skipped);
    }
}
