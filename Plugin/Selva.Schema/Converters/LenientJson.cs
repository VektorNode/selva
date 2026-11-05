using System;
using Newtonsoft.Json.Linq;

namespace Selva.Schema.Models;

/// <summary>
///     Reads a field from a schema object this build doesn't fully know, returning null when the
///     field is missing or holds another JSON type. A newer schema may reuse a field name with a
///     different type, and throwing there would drop the whole schema on load.
/// </summary>
internal static class LenientJson
{
    public static string String(JObject raw, string name)
    {
        return raw[name] is JValue { Type: JTokenType.String } value ? (string)value.Value : null;
    }

    public static Guid? Guid(JObject raw, string name)
    {
        return System.Guid.TryParse(String(raw, name), out var guid) ? guid : null;
    }

    public static int? Int(JObject raw, string name)
    {
        if (raw[name] is not JValue { Type: JTokenType.Integer } value)
        {
            return null;
        }

        return value.Value switch
        {
            int n => n,
            long n when n >= int.MinValue && n <= int.MaxValue => (int)n,
            _ => null
        };
    }

    public static double? Double(JObject raw, string name)
    {
        return raw[name] is JValue { Type: JTokenType.Integer or JTokenType.Float, Value: IConvertible n }
            ? n.ToDouble(null)
            : null;
    }

    public static bool? Bool(JObject raw, string name)
    {
        return raw[name] is JValue { Type: JTokenType.Boolean } value ? (bool)value.Value : null;
    }
}
