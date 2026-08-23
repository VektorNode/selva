using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Goos;
using Xunit;

namespace Selva.Tests;

// Color is a readonly struct with a private constructor — plain Json.NET deserializes it to
// default (transparent black), which silently erased every stroke/fill/text color when a
// goo was duplicated or a .gh file was saved and reopened. StyleJson's converter must keep
// colors intact through the round-trip.
public class StyleJsonTests
{
	[Fact]
	public void Stroke_color_survives_json_round_trip()
	{
		var stroke = new Stroke
		{
			Color = Color.Rgb(1f, 0.25f, 0f, 0.5f),
			Width = 0.7,
			DashArray = new[] { 2.0, 1.0 },
		};

		var copy = StyleJson.Deserialize<Stroke>(StyleJson.Serialize(stroke));

		Assert.Equal(stroke.Color, copy.Color);
		Assert.Equal(stroke.Width, copy.Width);
		Assert.Equal(stroke.DashArray, copy.DashArray);
	}

	[Fact]
	public void Fill_color_survives_json_round_trip()
	{
		var fill = new Fill
		{
			Color = Color.FromHex("#3366CC"),
			Rule = FillRule.NonZero,
			Pattern = HatchPattern.Lines,
			PatternScale = 2.0,
		};

		var copy = StyleJson.Deserialize<Fill>(StyleJson.Serialize(fill));

		Assert.Equal(fill.Color, copy.Color);
		Assert.Equal(fill.Rule, copy.Rule);
		Assert.Equal(fill.Pattern, copy.Pattern);
	}

	[Fact]
	public void TextStyle_color_survives_json_round_trip()
	{
		var style = new TextStyle
		{
			Color = Color.Rgb((byte)10, (byte)20, (byte)30),
			FontSize = 4.5,
			Weight = FontWeight.Bold,
		};

		var copy = StyleJson.Deserialize<TextStyle>(StyleJson.Serialize(style));

		Assert.Equal(style.Color, copy.Color);
		Assert.Equal(style.Weight, copy.Weight);
	}

	[Fact]
	public void PathStyle_nested_colors_survive_json_round_trip()
	{
		var pathStyle = new PathStyle
		{
			Stroke = new Stroke { Color = Color.Rgb(0f, 1f, 0f) },
			Fill = new Fill { Color = Color.Cmyk(0.1f, 0.2f, 0.3f, 0.4f) },
		};

		var copy = StyleJson.Deserialize<PathStyle>(StyleJson.Serialize(pathStyle));

		Assert.Equal(pathStyle.Stroke.Color, copy.Stroke.Color);
		Assert.Equal(pathStyle.Fill.Color, copy.Fill.Color);
	}

	[Fact]
	public void Named_and_cmyk_color_spaces_round_trip()
	{
		var named = new Fill { Color = Color.Named("currentColor") };
		var cmyk = new Fill { Color = Color.Cmyk(0.5f, 0.4f, 0.3f, 0.2f, 0.9f) };

		Assert.Equal(named.Color, StyleJson.Deserialize<Fill>(StyleJson.Serialize(named)).Color);
		Assert.Equal(cmyk.Color, StyleJson.Deserialize<Fill>(StyleJson.Serialize(cmyk)).Color);
	}

	[Fact]
	public void Legacy_json_written_without_converter_reads_back_with_colors()
	{
		// Files saved before the converter existed contain Json.NET's default property dump
		// (it could serialize the get-only properties — only deserialization was broken).
		var legacy = Newtonsoft.Json.JsonConvert.SerializeObject(
			new Stroke { Color = Color.Rgb(1f, 0f, 0f), Width = 0.5 });

		var restored = StyleJson.Deserialize<Stroke>(legacy);

		Assert.Equal(Color.Rgb(1f, 0f, 0f), restored.Color);
		Assert.Equal(0.5, restored.Width);
	}

	// NOTE: StrokeGoo.Duplicate() coverage lives with the Rhino-coupled suite, not here.
	// StrokeGoo derives from GH_Goo, so exercising it would require referencing Selva.GH,
	// which drags Grasshopper/RhinoCommon into this net8 test host and stops it starting
	// ("Failed to create CoreCLR"). The StyleJson serialization above is the Rhino-free
	// part of this contract and still gates in CI.
}
