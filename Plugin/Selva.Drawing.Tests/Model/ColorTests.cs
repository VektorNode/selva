using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model;

public class ColorTests
{
	[Fact]
	public void Rgb_clamps_floats_to_unit_range()
	{
		var c = Color.Rgb(1.5f, -0.2f, 0.5f, 2f);
		Assert.Equal(1f, c.R);
		Assert.Equal(0f, c.G);
		Assert.Equal(0.5f, c.B);
		Assert.Equal(1f, c.A);
		Assert.Equal(ColorSpace.Rgb, c.Space);
	}

	[Fact]
	public void Rgb_byte_overload_normalizes_to_floats()
	{
		var c = Color.Rgb((byte)255, (byte)128, (byte)0);
		Assert.Equal(1f, c.R);
		Assert.Equal(128f / 255f, c.G);
		Assert.Equal(0f, c.B);
	}

	[Fact]
	public void Cmyk_preserves_channels()
	{
		var c = Color.Cmyk(0.1f, 0.2f, 0.3f, 0.4f);
		Assert.Equal(ColorSpace.Cmyk, c.Space);
		Assert.Equal(0.1f, c.C);
		Assert.Equal(0.2f, c.M);
		Assert.Equal(0.3f, c.Y);
		Assert.Equal(0.4f, c.K);
	}

	[Fact]
	public void Named_round_trips()
	{
		var c = Color.Named("currentColor");
		Assert.Equal(ColorSpace.Named, c.Space);
		Assert.Equal("currentColor", c.Name);
	}

	[Theory]
	[InlineData("#FF8000", 1f, 128f / 255f, 0f, 1f)]
	[InlineData("FF8000", 1f, 128f / 255f, 0f, 1f)]
	[InlineData("#00FF00CC", 0f, 1f, 0f, 0xCC / 255f)]
	public void FromHex_parses_six_and_eight_digit(string hex, float r, float g, float b, float a)
	{
		var c = Color.FromHex(hex);
		Assert.Equal(r, c.R);
		Assert.Equal(g, c.G);
		Assert.Equal(b, c.B);
		Assert.Equal(a, c.A);
	}

	[Fact]
	public void Equality_by_value()
	{
		Assert.True(Color.Rgb(0.1f, 0.2f, 0.3f) == Color.Rgb(0.1f, 0.2f, 0.3f));
		Assert.True(Color.Rgb(1f, 0f, 0f) != Color.Rgb(0f, 0f, 0f));
		Assert.True(Color.Named("foo").Equals(Color.Named("foo")));
		Assert.False(Color.Rgb(0f, 0f, 0f).Equals(Color.Cmyk(0f, 0f, 0f, 1f))); // different spaces never equal
	}
}
