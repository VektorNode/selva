using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.Advanced;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Selva.Drawing.Rendering.Svg;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// A TextElement with a Hyperlink URL produces a clickable link annotation in the rendered
// PDF and an <a href> wrapper in the SVG. Both renderers read the same field; the model
// stays format-agnostic.
public class PdfHyperlinkTests
{
	private static Document BuildDocWithLink(string url)
	{
		return new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new TextElement
					{
						Text = "Click me",
						Position = new Point2D(20, 20),
						Style = new TextStyle { FontSize = 4 },
						Hyperlink = url,
						MeasuredBounds = new BoundingBox(20, 18, 50, 24),
					},
				},
			},
		};
	}

	[Fact]
	public void Pdf_emits_link_annotation_for_hyperlinked_text()
	{
		var bytes = new PdfRenderer().Render(BuildDocWithLink("https://example.com"));

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var page = reopened.Pages[0];
		var annots = page.Elements["/Annots"] as PdfArray;
		Assert.NotNull(annots);
		Assert.True(annots.Elements.Count >= 1, "Expected at least one annotation entry");

		var first = annots.Elements[0];
		var dict = first is PdfReference reference ? reference.Value as PdfDictionary : first as PdfDictionary;
		Assert.NotNull(dict);
		Assert.Equal("/Link", dict.Elements.GetName("/Subtype"));

		var actionItem = dict.Elements["/A"];
		var actionDict = actionItem is PdfReference ar ? ar.Value as PdfDictionary : actionItem as PdfDictionary;
		Assert.NotNull(actionDict);
		Assert.Equal("/URI", actionDict.Elements.GetName("/S"));
		Assert.Contains("example.com", actionDict.Elements.GetString("/URI"));
	}

	[Fact]
	public void Pdf_omits_link_annotation_when_hyperlinks_disabled()
	{
		var bytes = new PdfRenderer(new PdfRenderOptions { EmitHyperlinks = false })
			.Render(BuildDocWithLink("https://example.com"));

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var page = reopened.Pages[0];
		Assert.False(page.Elements.ContainsKey("/Annots"));
	}

	[Fact]
	public void Svg_wraps_hyperlinked_text_in_anchor_element()
	{
		var svg = new SvgRenderer().Render(BuildDocWithLink("https://example.com"));
		Assert.Contains("<a href='https://example.com'>", svg);
		Assert.Contains("</a>", svg);
		Assert.Contains("Click me", svg);
	}

	[Fact]
	public void Svg_text_without_hyperlink_has_no_anchor_wrapper()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Content = new TextElement
					{
						Text = "Plain",
						Position = new Point2D(10, 10),
						Style = new TextStyle { FontSize = 3 },
						MeasuredBounds = new BoundingBox(10, 8, 30, 13),
					},
				},
			},
		};
		var svg = new SvgRenderer().Render(doc);
		Assert.DoesNotContain("<a href", svg);
	}
}
