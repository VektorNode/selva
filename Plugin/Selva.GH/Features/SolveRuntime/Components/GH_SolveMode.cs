using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.SolveRuntime.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.SolveRuntime.Components;

/// <summary>
///     Tells the definition whether this solve is a preview, so production-only work above the
///     file components (an unroll, a nesting) can be gated off while someone edits the form.
/// </summary>
/// <remarks>
///     A preview needs both the request's <c>SelvaMode</c> and the schema's <c>previewSolves</c>.
///     The canvas never previews, so this reads false there. Gate only what files use: a preview
///     must show the same model as a full solve.
/// </remarks>
public class GH_SolveMode : GH_Component
{
    public GH_SolveMode()
        : base("Solve Mode", "Mode",
            "Whether this solve is a preview. Gate production-only work with it (a Stream Filter, " +
            "or a component's own on/off input), so it only runs when someone downloads a file.",
            "Selva", "Utilities")
    {
    }

    public override Guid ComponentGuid => new Guid("78B50B54-AB29-49BC-A6AB-902531C15AA6");

    protected override Bitmap Icon => Resources.SolveMode;

    public override GH_Exposure Exposure => GH_Exposure.primary;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddBooleanParameter("Preview", "P",
            "True in a preview solve: files that only feed a Download are skipped. False in a full " +
            "solve, which makes every file.", GH_ParamAccess.item);
    }

    public override void AddedToDocument(GH_Document document)
    {
        base.AddedToDocument(document);
        // The runtime expires this when the mode changes, which it can only do once it exists.
        SolveRuntimes.For(document);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        DA.SetData(0, SolveRuntimes.For(OnPingDocument())?.RunSolveMode(this) == true);
    }
}
