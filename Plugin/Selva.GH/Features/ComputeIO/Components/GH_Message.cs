using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Raises a remark, warning, or error into the solve when Condition is false.
///     An error suppresses the solve's outputs: the web UI shows the message instead of
///     geometry it cannot trust.
/// </summary>
/// <remarks>
///     Grasshopper cannot abort a running solution, so an error does not halt computation —
///     everything downstream still solves. To actually skip expensive downstream work, wire
///     <c>Passed</c> into a Stream Gate or Cull so the failing branch carries no data.
///     Both transports key off <see cref="GH_Component.AddRuntimeMessage" />: locally the bridge
///     scans for it after the solution ends, and on Rhino.Compute an Error runtime message is
///     what populates the response's `errors` array.
/// </remarks>
public class GH_Message : GH_Component
{
    public GH_Message()
        : base("Message", "Msg",
            "Raise a remark, warning, or error when Condition is false. An error blocks the " +
            "solve's outputs from reaching the web UI (downstream components still compute).",
            "Selva", "Utilities")
    {
    }

    public override Guid ComponentGuid => new Guid("B7E4C2A1-3D9F-4E58-A6C0-8F1D5B2E7A93");

    protected override Bitmap Icon => null;

    public override GH_Exposure Exposure => GH_Exposure.primary;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddBooleanParameter("Condition", "C",
            "True passes. False raises the message at the given level.", GH_ParamAccess.item, true);
        pManager.AddTextParameter("Message", "M",
            "Text shown on the canvas and in the web UI when the condition is false.",
            GH_ParamAccess.item, "Condition failed");
        pManager.AddIntegerParameter("Level", "L",
            "0 = Remark, 1 = Warning, 2 = Error. Only Error blocks the outputs.",
            GH_ParamAccess.item, LevelError);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddBooleanParameter("Passed", "P",
            "Mirrors Condition. Gate downstream data with this to skip work on the failing branch.",
            GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var condition = true;
        var message = "Condition failed";
        var level = LevelError;

        if (!DA.GetData(0, ref condition)) return;
        DA.GetData(1, ref message);
        DA.GetData(2, ref level);

        DA.SetData(0, condition);

        if (condition) return;

        if (string.IsNullOrWhiteSpace(message))
        {
            message = "Condition failed";
        }

        var runtimeLevel = ToRuntimeLevel(level);
        var aborts = runtimeLevel == GH_RuntimeMessageLevel.Error;

        // Rhino.Compute flattens runtime messages to bare strings with no component attribution,
        // so a deployed solve can only recognise a deliberate block by this marker in the text.
        // The local bridge strips it before the message reaches the UI.
        AddRuntimeMessage(runtimeLevel,
            aborts ? SolveDiagnostics.BlockedMarker + " " + message : message);

        if (!aborts)
        {
            return;
        }

        // Report BEFORE aborting. The abort skips SolutionEnd, so the bridge's usual post-solve
        // collection never runs and this is the only report the UI will get. Safe from inside a
        // solve: the broadcast is background socket I/O and never waits on the browser.
        SolveMessageBroadcaster.SendBlocked(message,
            string.IsNullOrWhiteSpace(NickName) ? Name : NickName);

        // Cooperative: Grasshopper stops at the next component boundary rather than instantly, so
        // downstream components are skipped instead of computing a result nobody will see. It
        // tears the solution down rather than pausing it — there is no partial result to keep.
        // No-op on Rhino.Compute, which solves headless in one request; there the error still
        // reaches the client through the response's `errors` array.
        OnPingDocument()?.RequestAbortSolution();
    }

    // Mirrors GH_RuntimeMessageLevel's ordering so the input reads the same as the enum.
    private const int LevelRemark = 0;
    private const int LevelWarning = 1;
    private const int LevelError = 2;

    /// <summary>Out-of-range values fall back to Error: a mis-wired level must not silently
    /// downgrade a block into a remark nobody reads.</summary>
    private static GH_RuntimeMessageLevel ToRuntimeLevel(int level)
    {
        switch (level)
        {
            case LevelRemark: return GH_RuntimeMessageLevel.Remark;
            case LevelWarning: return GH_RuntimeMessageLevel.Warning;
            default: return GH_RuntimeMessageLevel.Error;
        }
    }
}
