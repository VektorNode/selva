using System.IO;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Multi-page documents must produce multi-page PDFs whose pages line up with the model:
// same count, per-page paper sizes preserved when auto-fit is disabled, and per-page
// content rendered without leaking state across pages.
public class PdfMultiPageTests
{
	[Fact]
	public void Document_with_four_pages_produces_four_page_pdf()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				MakePage("Page 1", PaperSize.A3),
				MakePage("Page 2", PaperSize.A3),
				MakePage("Page 3", PaperSize.A3),
				MakePage("Page 4", PaperSize.A3),
			},
		};

		var bytes = new PdfRenderer(new PdfRenderOptions { AutoFitToContent = false }).Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(4, reopened.PageCount);
	}

	[Fact]
	public void Per_page_paper_sizes_round_trip()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Size = PaperSize.A4, Content = new GroupElement() },
				new Page { Size = PaperSize.A3, Content = new GroupElement() },
				new Page { Size = PaperSize.A2, Content = new GroupElement() },
			},
		};

		var bytes = new PdfRenderer(new PdfRenderOptions { AutoFitToContent = false }).Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(3, reopened.PageCount);

		const double mmToPt = 72.0 / 25.4;
		Assert.InRange(reopened.Pages[0].Width.Point, 210 * mmToPt - 0.1, 210 * mmToPt + 0.1);
		Assert.InRange(reopened.Pages[1].Width.Point, 297 * mmToPt - 0.1, 297 * mmToPt + 0.1);
		Assert.InRange(reopened.Pages[2].Width.Point, 420 * mmToPt - 0.1, 420 * mmToPt + 0.1);
	}

	[Fact]
	public void Empty_document_still_produces_one_blank_page()
	{
		var bytes = new PdfRenderer().Render(new Document());

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	private static Page MakePage(string title, PaperSize size)
	{
		var path = new Path.Builder()
			.MoveTo(10, 10).LineTo(50, 10).LineTo(50, 30).Close().Build();
		return new Page
		{
			Title = title,
			Size = size,
			Content = new PathElement { Path = path },
		};
	}
}
