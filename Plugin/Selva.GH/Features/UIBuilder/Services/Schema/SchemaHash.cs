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
///     Content hash of a UISchema. Used for save-conflict detection between the
///     UI's last-seen canonical and the server's current canonical.
///
///     The hash is computed by serializing the schema to JSON with object keys
///     recursively sorted, then SHA-256 of the UTF-8 bytes. Sorting keys makes
///     the hash stable across serializer key ordering, which Newtonsoft does
///     not guarantee for anonymous objects or dictionaries.
///
///     The root-level "created" / "lastModified" timestamps are excluded: they are
///     metadata, not schema content, and both default to DateTime.UtcNow and get bumped
///     on disk save and on migration. Including them made the hash non-reproducible across
///     persistence boundaries and could spuriously reject saves. The hash is content-only.
/// </summary>
public static class SchemaHash
{
    // Root-level UISchema metadata fields (JSON property names) that must not affect the content hash.
    private static readonly string[] ExcludedRootKeys = { "created", "lastModified" };

    private static readonly JsonSerializerSettings HashSerializerSettings = new JsonSerializerSettings
    {
        NullValueHandling = NullValueHandling.Ignore,
        DefaultValueHandling = DefaultValueHandling.Ignore,
        // Newtonsoft has no built-in converter for System.Drawing.Color and serializes it as a
        // POCO — which on Mono/macOS yields a null property name and throws ArgumentNullException
        // ('key'). Any stray Color in the schema must serialize to a hex string instead.
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
    ///     Serializes System.Drawing.Color as a hex string (e.g. "#FF5733"). Read-only: the hash
    ///     path never deserializes. Guards against Newtonsoft's default Color handling, which throws
    ///     a null-key ArgumentNullException on Mono/macOS.
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
