using System;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Goos;

public class TextStyleGoo : IGH_Goo
{
    public TextStyleGoo() { }
    public TextStyleGoo(TextStyle value) { Value = value; }

    public TextStyle Value { get; set; }

    public bool IsValid => Value != null;
    public string IsValidWhyNot => Value == null ? "TextStyle is null" : string.Empty;
    public string TypeName => "TextStyle";
    public string TypeDescription => "Text style (font, size, color, alignment)";

    // TextStyle is immutable, so Duplicate can share the instance instead of copying.
    public IGH_Goo Duplicate() => new TextStyleGoo(Value);

    public IGH_GooProxy EmitProxy() => null;

    public bool CastFrom(object source)
    {
        if (source == null) return false;
        if (source is TextStyleGoo tsg) { Value = tsg.Value; return Value != null; }
        if (source is TextStyle ts) { Value = ts; return true; }
        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(TextStyle)))
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
        writer.SetString("TextStyleJson", StyleJson.Serialize(Value));
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("TextStyleJson")) return false;
        Value = StyleJson.Deserialize<TextStyle>(reader.GetString("TextStyleJson"));
        return true;
    }

    public override string ToString()
    {
        if (Value == null) return "TextStyle (null)";
        return $"TextStyle: {Value.FontFamily} {Value.FontSize}mm {Value.Weight}";
    }
}
