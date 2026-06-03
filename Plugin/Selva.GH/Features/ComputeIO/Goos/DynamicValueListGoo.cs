using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO;

namespace Selva.GH.Features.ComputeIO.Goos;

/// <summary>
///     Goo carrying a runtime-computed value list routing payload { targetInputId, options }. Emitted
///     by the "Set Dynamic Value List" component and wired into a ContextBake (like file/chart outputs),
///     so all Selva outputs share one authoring gesture and one serialization contract.
/// </summary>
public class DynamicValueListGoo : GH_Goo<DynamicValueListGoo>, ISelvaSerializableGoo
{
    public DynamicValueListGoo()
    {
        m_value = this;
        Options = new Dictionary<string, string>();
    }

    public DynamicValueListGoo(Guid targetInputId, IDictionary<string, string> options)
    {
        m_value = this;
        TargetInputId = targetInputId;
        Options = new Dictionary<string, string>(options ?? new Dictionary<string, string>());
    }

    /// <summary>
    ///     Instance GUID of the Dynamic Value List input these options populate. Empty when unset.
    /// </summary>
    public Guid TargetInputId { get; set; } = Guid.Empty;

    /// <summary>
    ///     Computed options (name -> value).
    /// </summary>
    public Dictionary<string, string> Options { get; set; }

    public override bool IsValid => Options != null;
    public override string TypeName => "Dynamic Value List";
    public override string TypeDescription => "Runtime-computed value list routing payload";

    public override IGH_Goo Duplicate()
    {
        return new DynamicValueListGoo(TargetInputId, Options);
    }

    public override string ToString()
    {
        return $"Dynamic Value List: {Options?.Count ?? 0} option(s)";
    }

    // ISelvaSerializableGoo — Rhino.Compute returns this payload; the web UI routes it back into the
    // targeted Dynamic Value List input. Same shape the local collector produces.
    public string ToComputeJson()
    {
        return ToJObject().ToString(Formatting.None);
    }

    /// <summary>
    ///     { "targetInputId": "&lt;guid&gt;" | null, "options": { "name": "value", ... } }.
    /// </summary>
    public JObject ToJObject()
    {
        var options = new JObject();
        if (Options != null)
        {
            foreach (var kvp in Options)
            {
                options[kvp.Key] = kvp.Value;
            }
        }

        return new JObject
        {
            { "targetInputId", TargetInputId == Guid.Empty ? null : TargetInputId.ToString() },
            { "options", options }
        };
    }

    public override bool CastTo<TQ>(ref TQ target)
    {
        if (typeof(TQ).IsAssignableFrom(typeof(string)))
        {
            target = (TQ)(object)ToComputeJson();
            return true;
        }

        return false;
    }

    public override bool Write(GH_IWriter writer)
    {
        writer.SetString("DynamicValueListJson", ToComputeJson());
        return true;
    }

    public override bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("DynamicValueListJson"))
        {
            return false;
        }

        var json = reader.GetString("DynamicValueListJson");
        var obj = JObject.Parse(json);
        TargetInputId = Guid.TryParse((string)obj["targetInputId"], out var guid) ? guid : Guid.Empty;
        Options = obj["options"]?.ToObject<Dictionary<string, string>>() ?? new Dictionary<string, string>();
        return true;
    }
}
