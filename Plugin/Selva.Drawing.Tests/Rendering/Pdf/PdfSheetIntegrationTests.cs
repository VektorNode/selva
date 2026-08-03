using System.Collections.Generic;
using System.IO;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Selva.Drawing.Rendering.Svg;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// A complete drawing sheet — multi-view assembly drawing, title block, BOM, notes, and
// a revision table — fits on one A2 page and produces a valid PDF reopenable by PdfReader.
public class PdfSheetIntegrationTests
{
	[Fact]
	public void Full_sheet_renders_to_a_valid_one_page_pdf()
	{
		var doc = BuildSheet();
		var bytes = new PdfRenderer(new PdfRenderOptions { AutoFitToContent = false }).Render(doc);

		Assert.True(bytes.Length > 0);
		Assert.Equal((byte)'%', bytes[0]);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
		var page = reopened.Pages[0];
		var landscape = PaperSize.A2.Landscape();
		Assert.Equal(landscape.WidthMm, page.Width.Millimeter, 1);
		Assert.Equal(landscape.HeightMm, page.Height.Millimeter, 1);
	}

	[Fact]
	public void Full_sheet_renders_to_svg_with_title_and_revision_text()
	{
		var doc = BuildSheet();
		var svgs = new SvgRenderer().RenderAll(doc);
		Assert.Single(svgs);
		var svg = svgs[0];
		Assert.Contains("<svg", svg);
		Assert.Contains("Bracket assembly", svg);
		Assert.Contains("DESCRIPTION", svg);
		Assert.Contains("GENERAL NOTES", svg);
	}

	private static Document BuildSheet()
	{
		var part1 = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(60, 0).LineTo(60, 40).LineTo(0, 40).Close().Build(),
			Stroke = new Stroke { Width = 0.5 },
		};
		var part2 = new PathElement
		{
			Path = new Path.Builder().MoveTo(0, 0).LineTo(40, 0).LineTo(20, 30).Close().Build(),
			Stroke = new Stroke { Width = 0.5 },
		};

		var view1 = new DrawingView
		{
			Geometry = part1,
			Scale = 1.0,
			Border = new Stroke { Width = 0.25 },
			Padding = Margins.Uniform(4),
			Caption = DrawingView.FormatScaleLabel(1.0),
			Origin = new Point2D(20, 320),
		};
		var view2 = new DrawingView
		{
			Geometry = part2,
			Scale = 1.0,
			Border = new Stroke { Width = 0.25 },
			Padding = Margins.Uniform(4),
			Caption = "VIEW B  " + DrawingView.FormatScaleLabel(1.0),
			Origin = new Point2D(120, 320),
		};

		var titleValues = new Dictionary<string, string>
		{
			["Project"] = "Bracket assembly",
			["Client"] = "ACME Robotics",
			["Title"] = "Top plate, isometric",
			["DrawingNumber"] = "BR-001",
			["Revision"] = "B",
			["Scale"] = "1:1",
			["Sheet"] = "1 of 1",
			["Author"] = "FB",
			["Date"] = "2026-04-30",
			["Checker"] = "—",
		};
		var titleBlock = new TitleBlock
		{
			Rows = TitleBlock.Standard(titleValues, new BoundingBox(0, 0, 180, 40)).Rows,
			Size = new BoundingBox(0, 0, 180, 40),
			Origin = new Point2D(394, 20),
		};

		var bom = new Selva.Drawing.Model.Layout.Table
		{
			Origin = new Point2D(20, 80),
			ColumnWidths = new[]
			{
				Selva.Drawing.Model.Layout.GridLength.Absolute(15),
				Selva.Drawing.Model.Layout.GridLength.Absolute(25),
				Selva.Drawing.Model.Layout.GridLength.Star(1),
				Selva.Drawing.Model.Layout.GridLength.Absolute(15),
			},
			Header = new[]
			{
				new Selva.Drawing.Model.Layout.TableCell { Text = "Item" },
				new Selva.Drawing.Model.Layout.TableCell { Text = "Part" },
				new Selva.Drawing.Model.Layout.TableCell { Text = "Description" },
				new Selva.Drawing.Model.Layout.TableCell { Text = "Qty" },
			},
			Rows = new[]
			{
				new[] { Cell("1"), Cell("BRKT-01"), Cell("L-bracket, aluminium, anodised black"), Cell("1") },
				new[] { Cell("2"), Cell("PL-150"), Cell("Mounting plate, 6mm Al-6061"), Cell("1") },
				new[] { Cell("3"), Cell("M3-10"), Cell("Pan-head machine screw, A2 stainless"), Cell("4") },
				new[] { Cell("4"), Cell("M3-NUT"), Cell("Hex nut, A2 stainless steel"), Cell("4") },
			},
			Border = new Stroke { Width = 0.25 },
			DefaultCellStyle = new TextStyle { FontSize = 2.5 },
		};

		var revisions = new RevisionTable
		{
			Width = 130,
			Origin = new Point2D(444, 360),
			Entries = new[]
			{
				new RevisionEntry { Revision = "A", Date = "2026-04-15", Description = "Initial issue", By = "FB" },
				new RevisionEntry { Revision = "B", Date = "2026-04-30", Description = "Adjusted plate hole positions", By = "FB" },
			},
		};

		var notes = new NotesBlock
		{
			Title = "GENERAL NOTES",
			Origin = new Point2D(20, 180),
			Width = 130,
			Notes = new[]
			{
				"Tighten all M3 screws to 3 N·m.",
				"Apply medium-strength thread-locker (Loctite 243) on all threaded fasteners.",
				"Verify alignment with pin gauge before final torque.",
				"Surface finish Ra ≤ 1.6 unless otherwise specified.",
			},
		};

		var content = new GroupElement
		{
			Children = new DrawElement[] { view1, view2, bom, notes, revisions, titleBlock },
		};

		return new Document
		{
			Metadata = new DocumentMetadata { Title = "Bracket assembly", Author = "FB" },
			Pages = new[]
			{
				new Page
				{
					Title = "Sheet 1",
					Size = PaperSize.A2.Landscape(),
					Margins = Margins.Uniform(15),
					Content = content,
				},
			},
		};
	}

	private static Selva.Drawing.Model.Layout.TableCell Cell(string text)
		=> new Selva.Drawing.Model.Layout.TableCell { Text = text };
}
