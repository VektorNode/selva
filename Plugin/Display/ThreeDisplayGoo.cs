using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;

namespace Compuceraptor.Components.Display;

public class ThreeDisplayGoo : IGH_Goo
{
    public ThreeDisplayGoo()
    {
    }

    public ThreeDisplayGoo(ThreeDisplay value)
    {
        Value = value;
    }

    public ThreeDisplay Value { get; set; }

    public bool IsValid => !string.IsNullOrEmpty(Value.meshData);
    
    public string IsValidWhyNot => string.IsNullOrEmpty(Value.meshData) 
        ? "ThreeDisplay has no mesh data" 
        : string.Empty;
    
    public string TypeName => "ThreeDisplay";
    
    public string TypeDescription => "Three.js display data";

    public IGH_Goo Duplicate()
    {
        // Structs are value types, so this creates a copy automatically
        return new ThreeDisplayGoo(Value);
    }

    public IGH_GooProxy EmitProxy()
    {
        return null;
    }

    public bool CastFrom(object source)
    {
        if (source is ThreeDisplay td)
        {
            Value = td;
            return true;
        }

        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(ThreeDisplay)))
        {
            target = (T)(object)Value;
            return true;
        }

        target = default;
        return false;
    }

    public object ScriptVariable()
    {
        return Value;
    }

    public bool Write(GH_IWriter writer)
    {
        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
        };
        var json = JsonConvert.SerializeObject(Value, settings);
        writer.SetString("ThreeDisplayJson", json);
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("ThreeDisplayJson"))
            return false;
        
        var json = reader.GetString("ThreeDisplayJson");
        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
        };
        Value = JsonConvert.DeserializeObject<ThreeDisplay>(json, settings);
        return true;
    }

    public override string ToString()
    {
        return $"ThreeDisplay: (V: {Value.vertexCount}, F:{Value.faceCount})";
    }
}