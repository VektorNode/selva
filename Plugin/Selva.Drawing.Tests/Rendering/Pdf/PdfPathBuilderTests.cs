using System.IO;
using PdfSharpCore.Drawing;
using PdfSharpCore.Pdf;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Smoke + sanity checks for the model Path → XGraphicsPath converter. The arc-flattening
// algorithm is the only non-trivial piece; "sanity" here means the resulting XGraphicsPath
// can be drawn through PdfSharpCore without throwing and produces a non-zero-area page.
public class PdfPathBuilderTests
{
	[Fact]
	public void Empty_path_produces_empty_xpath()
	{
		var xpath = PdfPathBuilder.Build(Path.Empty);
		Assert.NotNull(xpath);
	}

	[Fact]
	public void Path_with_lines_renders_through_pdfsharpcore()
	{
		var path = new Path.Builder()
			.MoveTo(10, 10)
			.LineTo(50, 10)
			.LineTo(50, 50)
			.Close()
			.Build();

		var xpath = PdfPathBuilder.Build(path);
		Assert.NotNull(xpath);

		using var pdf = new PdfDocument();
		var page = pdf.AddPage();
		using var gfx = XGraphics.FromPdfPage(page);
		gfx.DrawPath(XPens.Black, xpath);
		using var ms = new MemoryStream();
		pdf.Save(ms, false);
		Assert.True(ms.Length > 0);
	}

	[Fact]
	public void Cubic_bezier_renders_through_pdfsharpcore()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0)
			.CubicTo(new Point2D(10, 20), new Point2D(30, 20), new Point2D(40, 0))
			.Build();

		var xpath = PdfPathBuilder.Build(path);

		using var pdf = new PdfDocument();
		var page = pdf.AddPage();
		using var gfx = XGraphics.FromPdfPage(page);
		gfx.DrawPath(XPens.Black, xpath);
		using var ms = new MemoryStream();
		pdf.Save(ms, false);
		Assert.True(ms.Length > 0);
	}

	[Fact]
	public void Svg_arc_flattens_to_cubics_and_renders()
	{
		// Quarter-circle from (50,0) to (0,50) with rx=ry=50, sweep=ccw (SVG sweep flag = 0).
		var path = new Path.Builder()
			.MoveTo(50, 0)
			.ArcTo(new Point2D(0, 50), 50, 50, 0, largeArc: false, sweepClockwise: false)
			.Build();

		var xpath = PdfPathBuilder.Build(path);

		using var pdf = new PdfDocument();
		var page = pdf.AddPage();
		using var gfx = XGraphics.FromPdfPage(page);
		gfx.DrawPath(XPens.Black, xpath);
		using var ms = new MemoryStream();
		pdf.Save(ms, false);
		Assert.True(ms.Length > 0);
	}

	[Fact]
	public void Multiple_subpaths_via_repeated_moveto_render()
	{
		// Outer rectangle + inner hole — the kind of shape SurfaceWithHoles uses.
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(20, 0).LineTo(20, 10).LineTo(0, 10).Close()
			.MoveTo(5, 3).LineTo(15, 3).LineTo(15, 7).LineTo(5, 7).Close()
			.Build();

		var xpath = PdfPathBuilder.Build(path);

		using var pdf = new PdfDocument();
		var page = pdf.AddPage();
		using var gfx = XGraphics.FromPdfPage(page);
		gfx.DrawPath(XPens.Black, xpath);
		using var ms = new MemoryStream();
		pdf.Save(ms, false);
		Assert.True(ms.Length > 0);
	}
}
