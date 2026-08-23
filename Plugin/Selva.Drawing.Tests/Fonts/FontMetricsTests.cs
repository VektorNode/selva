using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Style;
using FontStyle = Selva.Drawing.Model.Style.FontStyle;

namespace Selva.Drawing.Tests.Fonts;

public class FontMetricsTests
{
	[Fact]
	public void Inter_is_bundled_for_default_face()
	{
		Assert.True(FontMetrics.IsBundled("Inter"));
		Assert.True(FontMetrics.IsBundled("Inter", FontWeight.Bold));
	}

	[Fact]
	public void Unknown_family_falls_back_to_heuristic()
	{
		Assert.False(FontMetrics.IsBundled("ThisFontDoesNotExist"));
		var m = FontMetrics.Measure("Hello", "ThisFontDoesNotExist", 10);
		Assert.True(m.Width > 0);
		Assert.True(m.Ascent > 0);
	}

	[Fact]
	public void Empty_string_has_zero_width_but_nonzero_ascent()
	{
		var m = FontMetrics.Measure("", "Inter", 10);
		Assert.Equal(0, m.Width);
		Assert.True(m.Ascent > 0);
	}

	[Fact]
	public void Width_scales_linearly_with_font_size()
	{
		var ten = FontMetrics.Measure("Hello", "Inter", 10);
		var twenty = FontMetrics.Measure("Hello", "Inter", 20);
		Assert.Equal(twenty.Width, ten.Width * 2.0, 6);
	}

	[Theory]
	[InlineData("i", "W")]
	[InlineData("l", "M")]
	[InlineData("1", "8")]
	public void Different_glyphs_have_different_advances(string narrow, string wide)
	{
		var n = FontMetrics.Measure(narrow, "Inter", 10);
		var w = FontMetrics.Measure(wide, "Inter", 10);
		// Inter's tabular figures are equal-width, so '1' and '8' may tie — only check >= for that pair.
		if (narrow == "1" && wide == "8")
			Assert.True(w.Width >= n.Width);
		else
			Assert.True(w.Width > n.Width, $"Expected '{wide}' wider than '{narrow}' (got {w.Width} vs {n.Width})");
	}

	[Fact]
	public void Real_font_width_diverges_from_heuristic_for_wide_glyphs()
	{
		const double size = 10;
		var measured = FontMetrics.Measure("WWWWW", "Inter", size);
		var heuristic = 5 * size * 0.55;
		Assert.True(measured.Width > heuristic * 1.2,
			$"Real font width ({measured.Width}) should exceed heuristic ({heuristic}) for 5×W.");
	}

	[Fact]
	public void Bold_face_is_distinct_from_regular()
	{
		var regular = FontMetrics.Measure("HELLO", "Inter", 10, FontWeight.Normal);
		var bold = FontMetrics.Measure("HELLO", "Inter", 10, FontWeight.Bold);
		Assert.NotEqual(regular.Width, bold.Width);
	}

	[Fact]
	public void Font_family_stack_resolves_to_first_family()
	{
		var stack = FontMetrics.Measure("Hello", "Inter, Helvetica, sans-serif", 10);
		var direct = FontMetrics.Measure("Hello", "Inter", 10);
		Assert.Equal(direct.Width, stack.Width);
	}

	[Fact]
	public void Italic_falls_back_to_regular_face()
	{
		// No Inter Italic shipped yet - resolves to the regular face instead of throwing or using the heuristic.
		var italic = FontMetrics.Measure("Hello", "Inter", 10, FontWeight.Normal, FontStyle.Italic);
		var regular = FontMetrics.Measure("Hello", "Inter", 10, FontWeight.Normal, FontStyle.Normal);
		Assert.Equal(regular.Width, italic.Width);
	}

	[Fact]
	public void Measure_textstyle_overload_matches_direct_call()
	{
		var style = new TextStyle { FontFamily = "Inter", FontSize = 10, Weight = FontWeight.Bold };
		var fromStyle = FontMetrics.Measure("Hello", style);
		var direct = FontMetrics.Measure("Hello", "Inter", 10, FontWeight.Bold);
		Assert.Equal(direct.Width, fromStyle.Width);
	}
}
