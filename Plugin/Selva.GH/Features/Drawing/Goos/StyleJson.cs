using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Goos;

// Serializer settings for persisting drawing style types (Stroke, Fill, PathStyle,
// TextStyle) in goo Write/Read. Required because Color is a readonly struct with a private
// constructor: without the converter Json.NET silently deserializes default(Color) —
// transparent black — so every saved/duplicated style loses its color.
public static class StyleJson
{
    public static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
    {
        Converters = { new ColorJsonConverter() },
    };

    public static string Serialize(object value) => JsonConvert.SerializeObject(value, Settings);

    public static T Deserialize<T>(string json) => JsonConvert.DeserializeObject<T>(json, Settings);
}

// Writes the same property shape Json.NET produced by default (Space as int, channel
// floats, Name), so style JSON in previously saved .gh files reads back correctly.
public class ColorJsonConverter : JsonConverter<Color>
{
    public override void WriteJson(JsonWriter writer, Color value, JsonSerializer serializer)
    {
        writer.WriteStartObject();
        writer.WritePropertyName("Space");
        writer.WriteValue((int)value.Space);
        writer.WritePropertyName("R");
        writer.WriteValue(value.R);
        writer.WritePropertyName("G");
        writer.WriteValue(value.G);
        writer.WritePropertyName("B");
        writer.WriteValue(value.B);
        writer.WritePropertyName("A");
        writer.WriteValue(value.A);
        writer.WritePropertyName("C");
        writer.WriteValue(value.C);
        writer.WritePropertyName("M");
        writer.WriteValue(value.M);
        writer.WritePropertyName("Y");
        writer.WriteValue(value.Y);
        writer.WritePropertyName("K");
        writer.WriteValue(value.K);
        writer.WritePropertyName("Name");
        writer.WriteValue(value.Name);
        writer.WriteEndObject();
    }

    public override Color ReadJson(JsonReader reader, Type objectType, Color existingValue,
        bool hasExistingValue, JsonSerializer serializer)
    {
        if (reader.TokenType == JsonToken.Null) return Color.Black;
        var obj = JObject.Load(reader);

        var spaceToken = obj["Space"];
        var space = spaceToken == null
            ? ColorSpace.Rgb
            : spaceToken.Type == JTokenType.String
                ? (ColorSpace)Enum.Parse(typeof(ColorSpace), spaceToken.Value<string>(), true)
                : (ColorSpace)spaceToken.Value<int>();

        var a = obj["A"]?.Value<float>() ?? 1f;
        switch (space)
        {
            case ColorSpace.Cmyk:
                return Color.Cmyk(
                    obj["C"]?.Value<float>() ?? 0f,
                    obj["M"]?.Value<float>() ?? 0f,
                    obj["Y"]?.Value<float>() ?? 0f,
                    obj["K"]?.Value<float>() ?? 0f,
                    a);
            case ColorSpace.Named:
                var name = obj["Name"]?.Value<string>();
                return string.IsNullOrWhiteSpace(name) ? Color.Black : Color.Named(name);
            default:
                return Color.Rgb(
                    obj["R"]?.Value<float>() ?? 0f,
                    obj["G"]?.Value<float>() ?? 0f,
                    obj["B"]?.Value<float>() ?? 0f,
                    a);
        }
    }
}
