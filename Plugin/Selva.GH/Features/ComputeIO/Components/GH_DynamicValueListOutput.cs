using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Newtonsoft.Json.Linq;
using Selva.GH.Properties;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///     Emits a runtime-computed value list (name -> value options) that is routed back into a
///     <see cref="GetDynamicValueListParameter" /> in the web UI. The target input is referenced by its
///     Grasshopper instance GUID. The collector reads <see cref="Options" /> and <see cref="TargetInputId" />
///     after each solve; for Rhino.Compute the same payload is produced by <see cref="ToJson" />.
/// </summary>
public class GH_DynamicValueListOutput : GH_Component
{
    private Guid _targetInputId = Guid.Empty;

    public GH_DynamicValueListOutput()
        : base("Dynamic Value List", "DynVL Out",
            "Send a runtime-computed value list back to a Dynamic Value List input in the web UI",
            "Params", "Util")
    {
    }

    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("1D8E3F62-7B4A-4C9E-A0F1-5C2D8E7B3A41");

    protected override Bitmap Icon => Utils.ContextualiseIcon(Resources.GetValueList);

    /// <summary>
    ///     The instance GUID of the Dynamic Value List input this output's options populate.
    ///     Persisted on the component and set by the web UI builder (target-input picker).
    /// </summary>
    public Guid TargetInputId
    {
        get => _targetInputId;
        set => _targetInputId = value;
    }

    /// <summary>
    ///     The most recently computed options (name -> value), built from the "Options" input on solve.
    /// </summary>
    public Dictionary<string, string> Options { get; } = new Dictionary<string, string>();

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // List of "key" = value pair strings, e.g. "x" = 0
        pManager.AddTextParameter("Options", "O",
            "Value list options as a list of \"key\" = value pair strings (e.g. \"x\" = 0)",
            GH_ParamAccess.list);
        pManager[0].Optional = true;

        // Optional override of the persisted target input GUID.
        pManager.AddTextParameter("Target Input", "T",
            "Optional: the instance GUID of the Dynamic Value List input to populate. Usually set from the web UI builder instead.",
            GH_ParamAccess.item);
        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        // No downstream GH output — this is a sink read by the Selva collector / Rhino.Compute.
    }

    protected override void SolveInstance(IGH_DataAccess da)
    {
        var pairs = new List<string>();
        da.GetDataList(0, pairs);

        var targetOverride = string.Empty;
        if (da.GetData(1, ref targetOverride) && !string.IsNullOrWhiteSpace(targetOverride) &&
            Guid.TryParse(targetOverride.Trim(), out var overrideGuid))
        {
            _targetInputId = overrideGuid;
        }

        Options.Clear();
        foreach (var entry in ParseOptions(pairs))
        {
            Options[entry.Key] = entry.Value;
        }

        if (_targetInputId == Guid.Empty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "No target Dynamic Value List input set. Pick one in the web UI builder, or wire a GUID into 'Target Input'.");
        }
    }

    /// <summary>
    ///     Parse a list of "key" = value pair strings into ordered name -> value entries.
    ///     Splits on the first '=', trims whitespace, and strips a single pair of surrounding
    ///     quotes from the key. Entries without '=' or with an empty key are skipped.
    /// </summary>
    public static IEnumerable<KeyValuePair<string, string>> ParseOptions(IEnumerable<string> pairs)
    {
        if (pairs == null)
        {
            yield break;
        }

        foreach (var raw in pairs)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            var eq = raw.IndexOf('=');
            if (eq < 0)
            {
                continue;
            }

            var key = Unquote(raw.Substring(0, eq).Trim());
            var value = raw.Substring(eq + 1).Trim();

            if (string.IsNullOrEmpty(key))
            {
                continue;
            }

            yield return new KeyValuePair<string, string>(key, value);
        }
    }

    private static string Unquote(string s)
    {
        if (s.Length >= 2 &&
            ((s[0] == '"' && s[s.Length - 1] == '"') || (s[0] == '\'' && s[s.Length - 1] == '\'')))
        {
            return s.Substring(1, s.Length - 2);
        }

        return s;
    }

    /// <summary>
    ///     Serialize the routing payload for the web UI / Rhino.Compute:
    ///     { "targetInputId": "&lt;guid&gt;", "options": { "x": "0", ... } }.
    /// </summary>
    public JObject ToJson()
    {
        var options = new JObject();
        foreach (var kvp in Options)
        {
            options[kvp.Key] = kvp.Value;
        }

        return new JObject
        {
            { "targetInputId", _targetInputId == Guid.Empty ? null : _targetInputId.ToString() },
            { "options", options }
        };
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
