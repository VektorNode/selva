using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.ComputeIO;

namespace Selva.GH.Features.ComputeIO.Goos;

// Thin GH_Goo wrapper around DynamicValueListPayload (Rhino-free, unit-tested) — the runtime-computed
// { targetInputId, options } routing payload emitted by "Set Dynamic Value List". All serialization
// delegates to the payload; the two must never diverge.
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

    // Empty when unset.
    public Guid TargetInputId
    {
        get => Payload.TargetInputId;
        set => Payload.TargetInputId = value;
    }

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

    // Rhino.Compute returns this payload; the web UI routes it back into the targeted input.
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
