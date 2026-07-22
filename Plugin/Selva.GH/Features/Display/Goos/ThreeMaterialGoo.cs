using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Features.Display.Services;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.Display.Goos;

public class ThreeMaterialGoo : IGH_Goo
{
    public ThreeMaterialGoo()
    {
    }

    public ThreeMaterialGoo(ThreeMaterial value)
    {
        Value = value;
    }

    public ThreeMaterial Value { get; set; }

    public bool IsValid => Value != null;

    public string IsValidWhyNot => Value == null ? "ThreeMaterial is null" : string.Empty;

    public string TypeName => "ThreeMaterial";

    public string TypeDescription => "Material properties for web display";

    public IGH_Goo Duplicate()
    {
        if (Value == null)
        {
            return new ThreeMaterialGoo();
        }

        // Grasshopper duplicates goos liberally during solves and data-tree ops, so this must be
        // cheap. ThreeMaterial is a flat bag of value types + one string — a memberwise copy is a
        // faithful deep copy (the previous Newtonsoft serialize+parse round-trip paid reflection
        // per duplication for the same result).
        var copy = new ThreeMaterial
        {
            Color = Value.Color,
            Metalness = Value.Metalness,
            Roughness = Value.Roughness,
            Opacity = Value.Opacity,
            Transparent = Value.Transparent,
            Map = Value.Map
        };
        return new ThreeMaterialGoo(copy);
    }

    public IGH_GooProxy EmitProxy()
    {
        return null;
    }

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
                    Converters = new List<JsonConverter> { new ColorJsonConverter() }
                };
                Value = JsonConvert.DeserializeObject<ThreeMaterial>(s, settings);
                return Value != null;
            }
            catch (Exception ex)
            {
                Logger.Warn($"Failed to cast to ThreeMaterial: {ex.Message}");
            }
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
                Converters = new List<JsonConverter> { new ColorJsonConverter() }
            };
            target = (T)(object)JsonConvert.SerializeObject(Value, settings);
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
            Converters = new List<JsonConverter> { new ColorJsonConverter() }
        };
        var json = JsonConvert.SerializeObject(Value, settings);
        writer.SetString("ThreeMaterialJson", json);
        return true;
    }

    public bool Read(GH_IReader reader)
    {
        if (!reader.ItemExists("ThreeMaterialJson"))
        {
            return false;
        }

        var json = reader.GetString("ThreeMaterialJson");
        var settings = new JsonSerializerSettings
        {
            Converters = new List<JsonConverter> { new ColorJsonConverter() }
        };
        Value = JsonConvert.DeserializeObject<ThreeMaterial>(json, settings);
        return true;
    }

    public override string ToString()
    {
        if (Value == null)
        {
            return "ThreeMaterial (null)";
        }

        return
            $"ThreeMaterial: color={Value.Color}, metalness={Value.Metalness}, roughness={Value.Roughness}, opacity={Value.Opacity}, transparent={Value.Transparent}";
    }
}
