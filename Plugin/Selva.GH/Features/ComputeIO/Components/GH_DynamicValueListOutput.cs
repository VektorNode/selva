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

    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("1D8E3F62-7B4A-4C9E-A0F1-5C2D8E7B3A41");

    // A real component (not a contextual input param), so it uses the plain icon — no purple
    // ContextualiseIcon overlay, which is reserved for the "Get …" contextual params.
    protected override Bitmap Icon => Resources.GetValueList;

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
            "Routing payload { targetInputId, options } consumed by the web UI / Rhino.Compute",
            GH_ParamAccess.item);
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

        if (_targetInputId == Guid.Empty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "No target Get Dynamic Value List input set. Set the Target Input under this output's " +
                "Advanced settings in the Selva UI builder.");
        }

        da.SetData(0, new DynamicValueListGoo(_targetInputId, Options));
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
