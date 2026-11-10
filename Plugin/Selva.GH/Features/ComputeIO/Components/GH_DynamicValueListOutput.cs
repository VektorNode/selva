using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Selva.GH.Features.ComputeIO.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     "Set Dynamic Value List": emits a <see cref="DynamicValueListGoo" /> carrying a runtime-computed
///     value list (name -> value options) routed back into a <see cref="GetDynamicValueListParameter" />
///     ("Get Dynamic Value List") in the web UI, addressed by the target input's Grasshopper instance
///     GUID. Wire the output into a ContextBake like other Selva outputs; the Goo owns its compute JSON.
/// </summary>
public class GH_DynamicValueListOutput : GH_Component
{
    private Guid _targetInputId = Guid.Empty;

    public GH_DynamicValueListOutput()
        : base("Set Dynamic Value List", "Set DynVL",
            "Send a runtime-computed value list back to a Get Dynamic Value List input in the web UI",
            "Selva", "Utilities")
    {
    }

    // For components that ride the same output channel: schema discovery, the target lookup and
    // the collectors all find them as GH_DynamicValueListOutput.
    protected GH_DynamicValueListOutput(string name, string nickname, string description)
        : base(name, nickname, description, "Selva", "Utilities")
    {
    }

    /// <summary>
    ///     True when the component reads its target from a wire. The builder's target picker must not
    ///     overwrite it then.
    /// </summary>
    public virtual bool TargetFromWiring => WiredTargets().Count > 0;

    /// <summary>
    ///     The Get Dynamic Value Lists this component's output is wired into. A wired target resolves
    ///     its pick against these options in the same solve.
    /// </summary>
    protected List<GetDynamicValueListParameter> WiredTargets()
    {
        return Params.Output.Count == 0
            ? new List<GetDynamicValueListParameter>()
            : WiredInputs.Fed(Params.Output[0]).OfType<GetDynamicValueListParameter>().ToList();
    }

    /// <summary>
    ///     Suggests wiring the output into the target picked in the builder, unless the options are
    ///     computed from that input: the wire would close a loop, and Grasshopper refuses loops.
    /// </summary>
    protected void SuggestWiringTarget(Guid targetId)
    {
        var target = OnPingDocument()?.FindObject(targetId, true);
        if (target == null || WiredInputs.FeedsComponent(target, this))
        {
            return;
        }

        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"Wire the output into \"{target.NickName}\" too, so its pick updates in the same solve " +
            "instead of one solve later.");
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("1D8E3F62-7B4A-4C9E-A0F1-5C2D8E7B3A41");

    // A real component (not a contextual input param), so it uses the plain icon — no purple
    // ContextualiseIcon overlay, which is reserved for the "Get …" contextual params.
    protected override Bitmap Icon => Resources.SetDynamicValueList;

    /// <summary>Instance GUID of the Dynamic Value List input this output's options populate.</summary>
    public Guid TargetInputId
    {
        get => _targetInputId;
        set => _targetInputId = value;
    }

    public Dictionary<string, string> Options { get; } = new Dictionary<string, string>();

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Options", "O",
            "Value list options as a list of \"key\" = value pair strings (e.g. \"x\" = 0)",
            GH_ParamAccess.list);
        pManager[0].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Dynamic Value List", "DVL",
            "Wire into the Get Dynamic Value List it fills, and into a Context Bake so the options reach " +
            "the web UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess da)
    {
        var pairs = new List<string>();
        da.GetDataList(0, pairs);

        Options.Clear();
        var duplicateNames = new List<string>();
        foreach (var entry in OptionPairParser.Parse(pairs))
        {
            // Option names must be unique — they are the value list's keys. A duplicate would
            // silently shadow an earlier entry, so fail loudly and let the author fix the source.
            if (Options.ContainsKey(entry.Key))
            {
                duplicateNames.Add(entry.Key);
                continue;
            }

            Options[entry.Key] = entry.Value;
        }

        if (duplicateNames.Count > 0)
        {
            Options.Clear();
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                $"Duplicate option name(s): {string.Join(", ", duplicateNames.Distinct())}. " +
                "Option names must be unique.");
            return;
        }

        var targets = WiredTargets();
        var wired = targets.FirstOrDefault();
        if (wired != null)
        {
            _targetInputId = wired.InstanceGuid;
            if (targets.Count > 1)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Wire the output into one Get Dynamic Value List; only the first gets these options.");
            }
        }
        else if (_targetInputId == Guid.Empty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "No target set. Wire the output into the Get Dynamic Value List it fills.");
        }
        else
        {
            SuggestWiringTarget(_targetInputId);
        }

        da.SetData(0, new DynamicValueListGoo(new DynamicValueListPayload(_targetInputId, Options)
        {
            ResolvedInSolve = wired != null
        }));
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString("TargetInputId", _targetInputId.ToString());
        return base.Write(writer);
    }

    public override bool Read(GH_IReader reader)
    {
        string guidStr = null;
        if (reader.TryGetString("TargetInputId", ref guidStr) && Guid.TryParse(guidStr, out var guid))
        {
            _targetInputId = guid;
        }

        return base.Read(reader);
    }
}
