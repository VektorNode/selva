using System;
using System.Drawing;
using Newtonsoft.Json;

namespace Selva.GH.Features.Display.Services;

/// <summary>
///   JSON converter for System.Drawing.Color to HTML color strings.
/// </summary>
public class ColorJsonConverter : JsonConverter<Color>
{
	public override void WriteJson(JsonWriter writer, Color value, JsonSerializer serializer)
	{
		writer.WriteValue(ColorTranslator.ToHtml(value));
	}

	public override Color ReadJson(JsonReader reader, Type objectType, Color existingValue, bool hasExistingValue,
		JsonSerializer serializer)
	{
		return ColorTranslator.FromHtml((string)reader.Value);
	}
}
