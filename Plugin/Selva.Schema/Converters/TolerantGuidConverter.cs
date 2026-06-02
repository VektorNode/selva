using System;
using Newtonsoft.Json;

namespace Selva.Schema.Models;

/// <summary>
///     Reads a <see cref="Guid" /> from JSON, tolerating the empty string and null that the web UI
///     emits for an unset GUID field (e.g. a dynamic value list output before its target input is
///     picked). Both map to <see cref="Guid.Empty" /> instead of throwing. Writing is unchanged.
///     Applied by the schema generator to every GUID-typed property.
/// </summary>
public class TolerantGuidConverter : JsonConverter<Guid>
{
    public override Guid ReadJson(JsonReader reader, Type objectType, Guid existingValue,
        bool hasExistingValue, JsonSerializer serializer)
    {
        if (reader.TokenType == JsonToken.Null)
        {
            return Guid.Empty;
        }

        var value = reader.Value?.ToString();
        return string.IsNullOrWhiteSpace(value) ? Guid.Empty : Guid.Parse(value);
    }

    public override void WriteJson(JsonWriter writer, Guid value, JsonSerializer serializer)
    {
        writer.WriteValue(value.ToString());
    }
}
