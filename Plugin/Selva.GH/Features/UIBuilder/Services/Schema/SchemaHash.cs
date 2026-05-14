using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Content hash of a UISchema. Used for save-conflict detection between the
///     UI's last-seen canonical and the server's current canonical.
///
///     The hash is computed by serializing the schema to JSON with object keys
///     recursively sorted, then SHA-256 of the UTF-8 bytes. Sorting keys makes
///     the hash stable across serializer key ordering, which Newtonsoft does
///     not guarantee for anonymous objects or dictionaries.
/// </summary>
public static class SchemaHash
{
    private static readonly JsonSerializerSettings HashSerializerSettings = new JsonSerializerSettings
    {
        NullValueHandling = NullValueHandling.Ignore,
        DefaultValueHandling = DefaultValueHandling.Ignore
    };

    public static string Compute(UISchema schema)
    {
        if (schema == null) return string.Empty;

        var json = JsonConvert.SerializeObject(schema, HashSerializerSettings);
        var canonical = SortJson(JToken.Parse(json)).ToString(Formatting.None);

        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    private static JToken SortJson(JToken token)
    {
        switch (token.Type)
        {
            case JTokenType.Object:
                var sorted = new JObject();
                foreach (var prop in ((JObject)token).Properties()
                             .OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    sorted.Add(prop.Name, SortJson(prop.Value));
                }
                return sorted;

            case JTokenType.Array:
                var array = new JArray();
                foreach (var item in (JArray)token)
                {
                    array.Add(SortJson(item));
                }
                return array;

            default:
                return token;
        }
    }
}
