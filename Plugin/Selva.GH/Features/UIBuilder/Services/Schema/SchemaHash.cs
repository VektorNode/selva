using System;
using System.Drawing;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services.Schema;

/// <summary>
///     Content hash of a UISchema, for save-conflict detection between the UI's last-seen
///     canonical and the server's current canonical.
///
///     Serializes the schema to JSON with object keys recursively sorted, then SHA-256 of the
///     UTF-8 bytes. Sorting keys makes the hash stable across serializer key ordering, which
///     Newtonsoft does not guarantee for anonymous objects or dictionaries.
/// </summary>
public static class SchemaHash
{
    // "created"/"lastModified" are metadata, not content: both get bumped on disk save and on
    // migration, so including them would make the hash non-reproducible across persistence
    // boundaries and could spuriously reject saves.
    private static readonly string[] ExcludedRootKeys = { "created", "lastModified" };

    private static readonly JsonSerializerSettings HashSerializerSettings = new JsonSerializerSettings
    {
        NullValueHandling = NullValueHandling.Ignore,
        DefaultValueHandling = DefaultValueHandling.Ignore,
        Converters = { new ColorHexConverter() }
    };

    public static string Compute(UISchema schema)
    {
        if (schema == null) return string.Empty;

        var json = JsonConvert.SerializeObject(schema, HashSerializerSettings);
        var root = JToken.Parse(json);
        if (root is JObject rootObject)
        {
            foreach (var key in ExcludedRootKeys)
            {
                rootObject.Remove(key);
            }
        }

        var canonical = JsonConvert.SerializeObject(SortJson(root), Formatting.None);

        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    /// <summary>
    ///     Serializes System.Drawing.Color as a hex string (e.g. "#FF5733"). Newtonsoft has no
    ///     built-in converter for Color and falls back to serializing it as a POCO, which on
    ///     Mono/macOS yields a null property name and throws ArgumentNullException.
    /// </summary>
    private sealed class ColorHexConverter : JsonConverter<Color>
    {
        public override void WriteJson(JsonWriter writer, Color value, JsonSerializer serializer)
        {
            writer.WriteValue(ColorTranslator.ToHtml(value));
        }

        public override Color ReadJson(JsonReader reader, Type objectType, Color existingValue,
            bool hasExistingValue, JsonSerializer serializer)
        {
            throw new NotSupportedException("ColorHexConverter is serialize-only.");
        }
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
