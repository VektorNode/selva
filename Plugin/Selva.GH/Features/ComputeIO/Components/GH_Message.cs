using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Raises a remark, warning, or error into the solve when Condition is false.
///     An error suppresses the solve's outputs: the web UI shows the message instead of
///     geometry it cannot trust.
/// </summary>
/// <remarks>
///     An error does not abort the solution. <c>RequestAbortSolution()</c> makes Grasshopper wipe
///     the aborting component's own runtime messages before <c>SolutionEnd</c>, which would erase
///     the very error that marks the block on both transports (verified on Rhino 8.35). So the
///     solve runs to completion and everything downstream still computes; to skip expensive work
///     on the failing branch, wire <c>Passed</c> into a Stream Gate or Cull.
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
            "Remark, Warning, or Error. Only Error blocks the outputs. Right-click the input to "
            + "pick by name.",
            GH_ParamAccess.item, LevelError);
        pManager.AddIntegerParameter("Notify", "N",
            "How the message reaches the user: Popup interrupts with a dialog, Log adds it to "
            + "the message list without interrupting. Errors always interrupt. Right-click the "
            + "input to pick by name.",
            GH_ParamAccess.item, NotifyPopup);

        // Named values give each input a right-click list of readable options, so an author picks
        // "Warning" instead of remembering that 1 means warning.
        AddNamedValues(pManager[2] as Param_Integer,
            ("Remark", LevelRemark), ("Warning", LevelWarning), ("Error", LevelError));
        AddNamedValues(pManager[3] as Param_Integer,
            ("Popup", NotifyPopup), ("Log", NotifyLog));

        // Every input has a default, so none is required. Without this Grasshopper refuses to
        // run SolveInstance and raises its own "Parameter failed to collect data" warning the
        // moment an upstream branch is empty — a warning about this component's wiring, shown
        // to the end user as if the definition had reported it.
        for (var i = 0; i < Params.Input.Count; i++)
        {
            Params.Input[i].Optional = true;
        }
    }

    private static void AddNamedValues(Param_Integer param, params (string Name, int Value)[] values)
    {
        if (param == null)
        {
            return;
        }

        foreach (var (name, value) in values)
        {
            param.AddNamedValue(name, value);
        }
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
        var notify = NotifyPopup;

        // Inputs are optional, so a false return means "nothing wired" and the initializer above
        // stands. Returning early instead would leave `Passed` empty and break the gate
        // downstream of it.
        DA.GetData(0, ref condition);
        DA.GetData(1, ref message);
        DA.GetData(2, ref level);
        DA.GetData(3, ref notify);

        DA.SetData(0, condition);

        if (condition) return;

        if (string.IsNullOrWhiteSpace(message))
        {
            message = "Condition failed";
        }

        var runtimeLevel = ToRuntimeLevel(level);
        var aborts = runtimeLevel == GH_RuntimeMessageLevel.Error;
        // An error withholds the result, so it interrupts whatever Notify says: an empty viewer
        // with the explanation buried in a log is worse than the interruption.
        var logOnly = !aborts && notify == NotifyLog;
        var source = string.IsNullOrWhiteSpace(NickName) ? Name : NickName;

        // Rhino.Compute flattens runtime messages to bare strings, losing the block flag, "an
        // author wrote this", and the author's Notify choice. All three travel as a marker in the
        // text instead; the reader strips them before the message reaches the UI.
        AddRuntimeMessage(runtimeLevel,
            (aborts
                ? SolveDiagnostics.BlockedMarker
                : logOnly
                    ? SolveDiagnostics.LogOnlyMarker
                    : SolveDiagnostics.AuthoredMarker)
            + " " + message);

        // The live channel carries the structured message while the solve is still running, on
        // both transports. The post-solve collection reports it again once the solve ends; the
        // UI shows the result's list after that, not the live one.
        SolveEventSink.Emit(OnPingDocument(), "diagnostic", SolveEventSink.DiagnosticPayload(
            new SolveDiagnostic
            {
                Level = aborts ? "error" : runtimeLevel == GH_RuntimeMessageLevel.Warning ? "warning" : "remark",
                Message = message,
                Source = source,
                // False under Notify = Log: the message is still the author's and still listed,
                // it just does not interrupt.
                IsGate = !logOnly
            }));
    }

    /// <summary>
    ///     Re-applies <c>Optional</c> after a load. Grasshopper serializes the flag per param, so
    ///     a definition saved before it was set keeps `Optional=false` and goes on raising
    ///     "Parameter failed to collect data" on an empty branch no matter what
    ///     <see cref="RegisterInputParams" /> says. Every input has a default, so this is always
    ///     safe, and it repairs already-published definitions without an upgrader — the param
    ///     list is unchanged, so wire indices are untouched.
    /// </summary>
    public override bool Read(GH_IO.Serialization.GH_IReader reader)
    {
        if (!base.Read(reader))
        {
            return false;
        }

        foreach (var param in Params.Input)
        {
            param.Optional = true;
        }

        return true;
    }

    // Mirrors GH_RuntimeMessageLevel's ordering so the input reads the same as the enum.
    private const int LevelRemark = 0;
    private const int LevelWarning = 1;
    private const int LevelError = 2;

    private const int NotifyPopup = 0;
    private const int NotifyLog = 1;

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
