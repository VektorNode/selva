using System;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Goos;

public class StrokeGoo : IGH_Goo
{
    public StrokeGoo() { }
    public StrokeGoo(Stroke value) { Value = value; }

    public Stroke Value { get; set; }

    public bool IsValid => Value != null;
    public string IsValidWhyNot => Value == null ? "Stroke is null" : string.Empty;
    public string TypeName => "Stroke";
    public string TypeDescription => "Stroke style (color, width, dash, caps)";

    public IGH_Goo Duplicate()
    {
        if (Value == null) return new StrokeGoo();
        var json = JsonConvert.SerializeObject(Value);
        var copy = JsonConvert.DeserializeObject<Stroke>(json);
        return new StrokeGoo(copy ?? Value);
    }

    public IGH_GooProxy EmitProxy() => null;

    public bool CastFrom(object source)
    {
        if (source == null) return false;
        if (source is StrokeGoo sg) { Value = sg.Value; return Value != null; }
        if (source is Stroke s) { Value = s; return true; }
        // Auto-unwrap a PathStyle so users can wire Path Style -> Stroke slots.
        if (source is PathStyleGoo psg && psg.Value?.Stroke != null) { Value = psg.Value.Stroke; return true; }
        if (source is PathStyle ps && ps.Stroke != null) { Value = ps.Stroke; return true; }
        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(Stroke)))
        {
            target = (T)(object)Value;
            return Value != null;
        }
        target = default;
        return false;
    }

    public object ScriptVariable() => Value;

    public bool Write(GH_IWriter writer)
    {
        writer.SetString("StrokeJson", JsonConvert.SerializeObject(Value));
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("StrokeJson")) return false;
        Value = JsonConvert.DeserializeObject<Stroke>(reader.GetString("StrokeJson"));
        return true;
    }

    public override string ToString()
    {
        if (Value == null) return "Stroke (null)";
        return $"Stroke: width={Value.Width}, color={Value.Color}";
    }
}
