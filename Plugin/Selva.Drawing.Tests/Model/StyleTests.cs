using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model;

public class StyleTests
{
	[Fact]
	public void Stroke_value_equality_includes_dashes()
	{
		var a = new Stroke { Width = 1, DashArray = new double[] { 2, 1 } };
		var b = new Stroke { Width = 1, DashArray = new double[] { 2, 1 } };
		var c = new Stroke { Width = 1, DashArray = new double[] { 1, 2 } };

		Assert.True(a.Equals(b));
		Assert.Equal(a.GetHashCode(), b.GetHashCode());
		Assert.False(a.Equals(c));
	}

	[Fact]
	public void Stroke_treats_null_and_empty_dashes_as_solid()
	{
		var a = new Stroke { DashArray = null };
		var b = new Stroke { DashArray = new double[0] };
		Assert.True(a.Equals(b));
	}

	[Fact]
	public void Fill_value_equality()
	{
		var a = new Fill { Color = Color.Rgb(1f, 0f, 0f), Rule = FillRule.NonZero };
		var b = new Fill { Color = Color.Rgb(1f, 0f, 0f), Rule = FillRule.NonZero };
		Assert.True(a.Equals(b));
		Assert.False(a.Equals(new Fill { Color = Color.Rgb(0f, 1f, 0f), Rule = FillRule.NonZero }));
	}

	[Fact]
	public void TextStyle_equality_covers_all_fields()
	{
		var a = new TextStyle { FontFamily = "Inter", FontSize = 3.0, Weight = FontWeight.Bold };
		var b = new TextStyle { FontFamily = "Inter", FontSize = 3.0, Weight = FontWeight.Bold };
		Assert.True(a.Equals(b));
		Assert.False(a.Equals(new TextStyle { FontFamily = "Inter", FontSize = 3.0 }));
	}
}
