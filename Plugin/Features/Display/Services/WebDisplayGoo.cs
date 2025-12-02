using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;

namespace Selva.Features.Display.Services;

/// <summary>
///   Grasshopper Goo wrapper for WebDisplay data to prevent double JSON encoding.
/// </summary>
public class WebDisplayGoo : GH_Goo<MeshBatch>
{
  public WebDisplayGoo()
  {
  }

  public WebDisplayGoo(MeshBatch value)
  {
    Value = value;
  }

  public override bool IsValid => Value != null && Value.Materials != null && Value.Groups != null;

  public override string TypeName => "WebDisplay";

  public override string TypeDescription => "Geometry data for web display";

  public override IGH_Goo Duplicate()
  {
    return new WebDisplayGoo(Value);
  }

  public override string ToString()
  {
    if (!IsValid) return "Invalid WebDisplay";
    return $"WebDisplay: {Value.Materials.Count} materials, {Value.Groups.Count} groups";
  }

  public override bool Write(GH_IWriter writer)
  {
    if (!IsValid) return false;

    var json = JsonConvert.SerializeObject(Value);
    writer.SetString("WebDisplayJson", json);
    return true;
  }

  public override bool Read(GH_IReader reader)
  {
    if (!reader.ItemExists("WebDisplayJson")) return false;

    var json = reader.GetString("WebDisplayJson");
    Value = JsonConvert.DeserializeObject<MeshBatch>(json);
    return true;
  }

  public override bool CastFrom(object source)
  {
    if (source is MeshBatch batch)
    {
      Value = batch;
      return true;
    }

    if (source is GH_String ghString)
      try
      {
        Value = JsonConvert.DeserializeObject<MeshBatch>(ghString.Value);
        return true;
      }
      catch
      {
        return false;
      }

    return false;
  }

  public override bool CastTo<Q>(ref Q target)
  {
    if (typeof(Q).IsAssignableFrom(typeof(MeshBatch)))
    {
      target = (Q)(object)Value;
      return true;
    }

    if (typeof(Q).IsAssignableFrom(typeof(GH_String)))
    {
      var json = JsonConvert.SerializeObject(Value);
      target = (Q)(object)new GH_String(json);
      return true;
    }

    if (typeof(Q).IsAssignableFrom(typeof(string)))
    {
      var json = JsonConvert.SerializeObject(Value);
      target = (Q)(object)json;
      return true;
    }

    return false;
  }

  public override object ScriptVariable()
  {
    // Return the JSON string directly for script access
    // This prevents double-encoding when accessed via GHPython or file I/O
    return JsonConvert.SerializeObject(Value);
  }
}
