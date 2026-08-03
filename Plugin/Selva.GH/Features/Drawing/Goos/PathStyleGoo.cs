using System;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Goos;

public class PathStyleGoo : IGH_Goo
{
    public PathStyleGoo() { }
    public PathStyleGoo(PathStyle value) { Value = value; }

    public PathStyle Value { get; set; }

    public bool IsValid => Value != null;
    public string IsValidWhyNot => Value == null ? "PathStyle is null" : string.Empty;
    public string TypeName => "PathStyle";
    public string TypeDescription => "Path style bundle (stroke + fill)";

    // PathStyle is immutable, so Duplicate can share the instance instead of copying.
    public IGH_Goo Duplicate() => new PathStyleGoo(Value);

    public IGH_GooProxy EmitProxy() => null;

    public bool CastFrom(object source)
    {
        if (source == null) return false;
        if (source is PathStyleGoo psg) { Value = psg.Value; return Value != null; }
        if (source is PathStyle ps) { Value = ps; return true; }
        // Promote a bare Stroke or Fill into a PathStyle so either side can feed this input.
        if (source is StrokeGoo sg && sg.Value != null) { Value = new PathStyle { Stroke = sg.Value }; return true; }
        if (source is Stroke s) { Value = new PathStyle { Stroke = s }; return true; }
        if (source is FillGoo fg && fg.Value != null) { Value = new PathStyle { Fill = fg.Value }; return true; }
        if (source is Fill f) { Value = new PathStyle { Fill = f }; return true; }
        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(PathStyle)))
        {
            target = (T)(object)Value;
            return Value != null;
        }
        if (typeof(T).IsAssignableFrom(typeof(Stroke)) && Value?.Stroke != null)
        {
            target = (T)(object)Value.Stroke;
            return true;
        }
        if (typeof(T).IsAssignableFrom(typeof(Fill)) && Value?.Fill != null)
        {
            target = (T)(object)Value.Fill;
            return true;
        }
        target = default;
        return false;
    }

    public object ScriptVariable() => Value;

    public bool Write(GH_IWriter writer)
    {
        writer.SetString("PathStyleJson", StyleJson.Serialize(Value));
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("PathStyleJson")) return false;
        Value = StyleJson.Deserialize<PathStyle>(reader.GetString("PathStyleJson"));
        return true;
    }

    public override string ToString()
    {
        if (Value == null) return "PathStyle (null)";
        return $"PathStyle: stroke={(Value.Stroke != null ? "yes" : "no")}, fill={(Value.Fill != null ? "yes" : "no")}";
    }
}
