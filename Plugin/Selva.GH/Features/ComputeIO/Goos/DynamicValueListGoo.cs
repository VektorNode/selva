using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO;

namespace Selva.GH.Features.ComputeIO.Goos;

/// <summary>
///     Goo carrying a runtime-computed value list routing payload { targetInputId, options }. Emitted
///     by the "Set Dynamic Value List" component and wired into a ContextBake (like file/chart outputs),
///     so all Selva outputs share one authoring gesture and one serialization contract.
///
///     The wire shape lives in <see cref="DynamicValueListPayload" /> (Rhino-free, unit-tested); this
///     class is the thin GH_Goo wrapper. The two must never diverge — all serialization delegates down.
/// </summary>
public class DynamicValueListGoo : GH_Goo<DynamicValueListGoo>, ISelvaSerializableGoo
{
    public DynamicValueListGoo()
    {
        m_value = this;
        Payload = new DynamicValueListPayload();
    }

    public DynamicValueListGoo(Guid targetInputId, IDictionary<string, string> options)
    {
        m_value = this;
        Payload = new DynamicValueListPayload(targetInputId, options);
    }

    public DynamicValueListGoo(DynamicValueListPayload payload)
    {
        m_value = this;
        Payload = payload ?? new DynamicValueListPayload();
    }

    public DynamicValueListPayload Payload { get; private set; }

    /// <summary>
    ///     Instance GUID of the Dynamic Value List input these options populate. Empty when unset.
    /// </summary>
    public Guid TargetInputId
    {
        get => Payload.TargetInputId;
        set => Payload.TargetInputId = value;
    }

    /// <summary>
    ///     Computed options (name -> value).
    /// </summary>
    public Dictionary<string, string> Options
    {
        get => Payload.Options;
        set => Payload.Options = value;
    }

    public override bool IsValid => Payload?.Options != null;
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
        return Payload.ToComputeJson();
    }

    public JObject ToJObject()
    {
        return Payload.ToJObject();
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
        writer.SetString("DynamicValueListJson", Payload.ToComputeJson());
        return true;
    }

    public override bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("DynamicValueListJson"))
        {
            return false;
        }

        Payload = DynamicValueListPayload.FromJson(reader.GetString("DynamicValueListJson"));
        return true;
    }
}
