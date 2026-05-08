using System;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Goos;

public class FillGoo : IGH_Goo
{
    public FillGoo() { }
    public FillGoo(Fill value) { Value = value; }

    public Fill Value { get; set; }

    public bool IsValid => Value != null;
    public string IsValidWhyNot => Value == null ? "Fill is null" : string.Empty;
    public string TypeName => "Fill";
    public string TypeDescription => "Fill style (color, opacity, hatch pattern)";

    public IGH_Goo Duplicate()
    {
        if (Value == null) return new FillGoo();
        var json = JsonConvert.SerializeObject(Value);
        var copy = JsonConvert.DeserializeObject<Fill>(json);
        return new FillGoo(copy ?? Value);
    }

    public IGH_GooProxy EmitProxy() => null;

    public bool CastFrom(object source)
    {
        if (source == null) return false;
        if (source is FillGoo fg) { Value = fg.Value; return Value != null; }
        if (source is Fill f) { Value = f; return true; }
        // Auto-unwrap a PathStyle so users can wire Path Style -> Fill slots.
        if (source is PathStyleGoo psg && psg.Value?.Fill != null) { Value = psg.Value.Fill; return true; }
        if (source is PathStyle ps && ps.Fill != null) { Value = ps.Fill; return true; }
        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(Fill)))
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
        writer.SetString("FillJson", JsonConvert.SerializeObject(Value));
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("FillJson")) return false;
        Value = JsonConvert.DeserializeObject<Fill>(reader.GetString("FillJson"));
        return true;
    }

    public override string ToString()
    {
        if (Value == null) return "Fill (null)";
        return $"Fill: color={Value.Color}, pattern={Value.Pattern}";
    }
}
