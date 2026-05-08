using System.IO;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Selva.Drawing.Rendering.Svg;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Phase 7 exit-criteria coverage. The plan calls for a one-page PDF with a 5-row × 4-column
// BOM table, generated from internalised data, with proper text wrapping in cells. We assert
// the PDF reopens (i.e. the layout pass + renderer produced a valid file) rather than
// snapshotting bytes — PdfSharpCore stamps creation dates that drift between runs.
public class PdfBomTableTests
{
	[Fact]
	public void Bom_table_renders_a_valid_pdf()
	{
		var doc = BuildBomDocument();
		var bytes = new PdfRenderer().Render(doc);

		Assert.True(bytes.Length > 0);
		Assert.Equal((byte)'%', bytes[0]);  // %PDF- header

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Bom_table_renders_to_svg()
	{
		var doc = BuildBomDocument();
		var svgs = new SvgRenderer().RenderAll(doc);
		Assert.Single(svgs);
		Assert.Contains("<svg", svgs[0]);
		// The first text run is the header — proves the layout pass ran and emitted text.
		Assert.Contains("Item", svgs[0]);
	}

	private static Document BuildBomDocument()
	{
		var bom = new Table
		{
			ColumnWidths = new[]
			{
				GridLength.Absolute(15),
				GridLength.Absolute(25),
				GridLength.Star(1),
				GridLength.Absolute(15),
			},
			Header = new[]
			{
				new TableCell { Text = "Item" },
				new TableCell { Text = "Part" },
				new TableCell { Text = "Description" },
				new TableCell { Text = "Qty" },
			},
			Rows = new[]
			{
				new[] { New("1"), New("M3-10"), New("Pan-head machine screw, A2 stainless"), New("4") },
				new[] { New("2"), New("M3-NUT"), New("Hex nut, A2 stainless steel — DIN 934"), New("4") },
				new[] { New("3"), New("M3-W"), New("Flat washer, A2 stainless — DIN 125-A"), New("8") },
				new[] { New("4"), New("BRKT-01"), New("Aluminium L-bracket, anodised black"), New("1") },
				new[] { New("5"), New("PL-150"), New("Mounting plate, 6mm Al-6061 milled"), New("1") },
			},
			Border = new Stroke { Width = 0.25 },
			DefaultCellStyle = new TextStyle { FontSize = 2.5 },
		};

		return new Document
		{
			Metadata = new DocumentMetadata { Title = "BOM Demo" },
			Pages = new[]
			{
				new Page
				{
					Title = "BOM",
					Size = PaperSize.A4,
					Content = new GroupElement { Children = new DrawElement[] { bom } },
				},
			},
		};
	}

	private static TableCell New(string text) => new TableCell { Text = text };
}
