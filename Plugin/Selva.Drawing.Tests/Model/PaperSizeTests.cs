using Selva.Drawing.Model;

namespace Selva.Drawing.Tests.Model;

public class PaperSizeTests
{
	[Fact]
	public void A_series_dimensions_match_iso_216()
	{
		Assert.Equal(297, PaperSize.A4.HeightMm);
		Assert.Equal(210, PaperSize.A4.WidthMm);
		Assert.Equal(420, PaperSize.A3.HeightMm);
		Assert.Equal(297, PaperSize.A3.WidthMm);
	}

	[Fact]
	public void Landscape_swaps_dimensions_when_portrait()
	{
		var land = PaperSize.A4.Landscape();
		Assert.Equal(297, land.WidthMm);
		Assert.Equal(210, land.HeightMm);
	}

	[Fact]
	public void Landscape_is_idempotent()
	{
		var land = PaperSize.A4.Landscape();
		Assert.Equal(land, land.Landscape());
	}

	[Fact]
	public void Portrait_round_trips_through_landscape()
	{
		Assert.Equal(PaperSize.A4, PaperSize.A4.Landscape().Portrait());
	}

	[Fact]
	public void Custom_size_constructs_with_no_name()
	{
		var p = PaperSize.Custom(123.5, 456.7);
		Assert.Equal(123.5, p.WidthMm);
		Assert.Equal(456.7, p.HeightMm);
		Assert.Null(p.Name);
	}

	[Fact]
	public void Margins_uniform_sets_all_sides()
	{
		var m = Margins.Uniform(10);
		Assert.Equal(10, m.Top);
		Assert.Equal(10, m.Right);
		Assert.Equal(10, m.Bottom);
		Assert.Equal(10, m.Left);
	}
}
