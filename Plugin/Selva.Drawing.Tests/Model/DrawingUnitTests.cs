using Selva.Drawing.Model;

namespace Selva.Drawing.Tests.Model;

public class DrawingUnitTests
{
	[Fact]
	public void Millimeters_are_identity()
	{
		Assert.Equal(12.0, DrawingUnit.Millimeters.ToMm(12), 9);
	}

	[Fact]
	public void Centimeters_convert_by_ten()
	{
		Assert.Equal(50.0, DrawingUnit.Centimeters.ToMm(5), 9);
	}

	[Fact]
	public void Inches_convert_by_25_4()
	{
		Assert.Equal(25.4, DrawingUnit.Inches.ToMm(1), 9);
		Assert.Equal(215.9, DrawingUnit.Inches.ToMm(8.5), 6);
	}

	[Fact]
	public void Points_convert_at_72_per_inch()
	{
		Assert.Equal(25.4, DrawingUnit.Points.ToMm(72), 6);
	}

	[Fact]
	public void Ansi_a_equals_letter()
	{
		Assert.Equal(PaperSize.Letter.WidthMm, PaperSize.AnsiA.WidthMm, 6);
		Assert.Equal(PaperSize.Letter.HeightMm, PaperSize.AnsiA.HeightMm, 6);
	}

	[Fact]
	public void Ansi_d_is_22_by_34_inches()
	{
		Assert.Equal(22 * 25.4, PaperSize.AnsiD.WidthMm, 6);
		Assert.Equal(34 * 25.4, PaperSize.AnsiD.HeightMm, 6);
	}

	[Fact]
	public void Arch_e_is_36_by_48_inches()
	{
		Assert.Equal(36 * 25.4, PaperSize.ArchE.WidthMm, 6);
		Assert.Equal(48 * 25.4, PaperSize.ArchE.HeightMm, 6);
	}
}
