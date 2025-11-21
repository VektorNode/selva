using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;

namespace ComputeBuilder.Display;

public class ThreeMaterialGoo : IGH_Goo
{
    public ThreeMaterialGoo() { }

    public ThreeMaterialGoo(ThreeMaterial value)
    {
        Value = value;
    }

    public ThreeMaterial Value { get; set; }

    public bool IsValid => Value != null;

    public string IsValidWhyNot => Value == null ? "ThreeMaterial is null" : string.Empty;

    public string TypeName => "ThreeMaterial";

    public string TypeDescription => "Material properties for ThreeDisplay";

    public IGH_Goo Duplicate()
    {
        if (Value == null)
            return new ThreeMaterialGoo();

        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
        };
        var json = JsonConvert.SerializeObject(Value, settings);
        var copy = JsonConvert.DeserializeObject<ThreeMaterial>(json, settings);
        return new ThreeMaterialGoo(copy ?? Value);
    }

    public IGH_GooProxy EmitProxy() => null;

    public bool CastFrom(object source)
    {
        if (source is ThreeMaterial tm)
        {
            Value = tm;
            return true;
        }
        if (source is string s)
        {
            try
            {
                var settings = new JsonSerializerSettings
                {
                    Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
                };
                Value = JsonConvert.DeserializeObject<ThreeMaterial>(s, settings);
                return Value != null;
            }
            catch { }
        }

        return false;
    }

    public bool CastTo<T>(out T target)
    {
        if (typeof(T).IsAssignableFrom(typeof(ThreeMaterial)))
        {
            target = (T)(object)Value;
            return true;
        }
        if (typeof(T) == typeof(string))
        {
            var settings = new JsonSerializerSettings
            {
                Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
            };
            target = (T)(object)JsonConvert.SerializeObject(Value, settings);
            return true;
        }

        target = default;
        return false;
    }

    public object ScriptVariable() => Value;

    public bool Write(GH_IWriter writer)
    {
        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
        };
        var json = JsonConvert.SerializeObject(Value, settings);
        writer.SetString("ThreeMaterialJson", json);
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("ThreeMaterialJson"))
            return false;

        var json = reader.GetString("ThreeMaterialJson");
        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new GeoMeshProcessor.ColorJsonConverter() }
        };
        Value = JsonConvert.DeserializeObject<ThreeMaterial>(json, settings);
        return true;
    }

    public override string ToString()
    {
        if (Value == null)
            return "ThreeMaterial (null)";
        return $"ThreeMaterial: color={Value.color}, metalness={Value.metalness}, roughness={Value.roughness}, opacity={Value.opacity}, transparent={Value.transparent}";
    }
}
