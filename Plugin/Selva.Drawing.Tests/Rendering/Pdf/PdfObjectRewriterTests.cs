using System.Collections.Generic;
using System.Text;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Rendering.Pdf;

public class PdfObjectRewriterTests
{
	private static readonly Encoding Latin1 = Encoding.GetEncoding("ISO-8859-1");

	// Catalog, page tree and /Info, with a classic xref table like PDFsharp's.
	private static byte[] MinimalPdf(string catalog)
	{
		var objects = new[] { catalog, "<</Type/Pages/Kids[]/Count 0>>", "<</Producer(PDFsharp)>>" };
		var sb = new StringBuilder("%PDF-1.4\n");
		var offsets = new List<int>();
		for (var i = 0; i < objects.Length; i++)
		{
			offsets.Add(sb.Length);
			sb.Append(i + 1).Append(" 0 obj\n").Append(objects[i]).Append("\nendobj\n");
		}

		var xrefAt = sb.Length;
		sb.Append("xref\n0 ").Append(objects.Length + 1).Append('\n').Append("0000000000 65535 f \n");
		foreach (var offset in offsets) sb.Append(offset.ToString("D10")).Append(" 00000 n \n");
		sb.Append("trailer\n<</Size 4/Root 1 0 R/Info 3 0 R>>\nstartxref\n").Append(xrefAt).Append("\n%%EOF\n");
		return Latin1.GetBytes(sb.ToString());
	}

	[Fact]
	public void An_unrecognised_layout_is_returned_untouched_with_a_warning()
	{
		var pdf = Latin1.GetBytes("%PDF-1.4\nnot a cross-reference table\n%%EOF\n");
		var warnings = new List<string>();

		var result = PdfObjectRewriter.ReplaceInfoAndMetadata(pdf, "<</Title(T)>>", null, warnings);

		Assert.Same(pdf, result);
		Assert.Equal(new[] { PdfObjectRewriter.UnrecognisedLayout }, warnings);
	}

	[Fact]
	public void A_catalog_without_metadata_reports_the_dropped_xmp()
	{
		var pdf = MinimalPdf("<</Type/Catalog/Pages 2 0 R>>");
		var warnings = new List<string>();

		var result = PdfObjectRewriter.ReplaceInfoAndMetadata(pdf, "<</Title(T)>>", Latin1.GetBytes("<x/>"), warnings);

		Assert.Contains("<</Title(T)>>", Latin1.GetString(result));
		Assert.Equal(new[] { PdfObjectRewriter.NoMetadataObject }, warnings);
	}

	[Fact]
	public void A_normal_render_has_no_warnings()
	{
		var renderer = new PdfRenderer();
		renderer.Render(new Document
		{
			Metadata = new DocumentMetadata { Title = "Sheet" },
			Pages = new[]
			{
				new Page
				{
					Content = new GroupElement
					{
						Children = new DrawElement[]
						{
							new TextElement { Text = "A", Position = new Point2D(10, 10), Style = new TextStyle { FontSize = 4 } },
						},
					},
				},
			},
		});

		Assert.Empty(renderer.Warnings);
	}
}
