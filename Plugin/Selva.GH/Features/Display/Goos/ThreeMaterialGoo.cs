using System;
using System.Collections.Generic;
using GH_IO.Serialization;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Features.Display.Services;
using Selva.GH.Utilities.Helpers;
using Selva.Slva;

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

        // Grasshopper duplicates goos liberally during solves and tree ops, so this must be cheap:
        // a memberwise copy, not a Newtonsoft round-trip.
        return new ThreeMaterialGoo(Value.Clone());
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

        var text =
            $"ThreeMaterial: color={Value.Color}, metalness={Value.Metalness}, roughness={Value.Roughness}, opacity={Value.Opacity}, transparent={Value.Transparent}";

        text += Describe("map", Value.Map) + Describe("roughnessMap", Value.RoughnessMap) +
                Describe("normalMap", Value.NormalMap);
        if (Value.MapSize != null) text += $", mapSize={Value.MapSize}";
        if (!string.IsNullOrEmpty(Value.Finish)) text += $", finish={Value.Finish}";
        if (Value.Emissive != null) text += $", emissive={Value.Emissive}";
        if (Value.Clearcoat != null) text += $", clearcoat={Value.Clearcoat}";
        if (Value.Anisotropy != null) text += $", anisotropy={Value.Anisotropy}";
        if (Value.Transmission != null) text += $", transmission={Value.Transmission}";
        if (Value.Thickness != null) text += $", thickness={Value.Thickness}";
        if (Value.AttenuationColor != null) text += $", tint={Value.AttenuationColor}";
        if (Value.Sheen != null) text += $", sheen={Value.Sheen}";
        return text;
    }

    // Data URIs are whole images; keep the readout short.
    private static string Describe(string name, string reference)
    {
        if (string.IsNullOrEmpty(reference)) return string.Empty;
        var shown = reference.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            ? "data URI"
            : reference.Length > 60 ? "..." + reference.Substring(reference.Length - 57) : reference;
        return $", {name}={shown}";
    }
}
