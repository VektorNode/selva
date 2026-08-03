using System;
using System.IO;
using System.Linq;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Color = Selva.Drawing.Model.Style.Color;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// PdfSharpCore stamps dates and a trailer ID into every produced file, so byte-level
// snapshotting is impractical; these tests check structural validity instead — header
// magic, parseable through PdfReader, expected pages/sizes, metadata round-trips.
public class PdfRendererTests
{
	private static byte[] RenderScene(DrawElement content, PdfRenderOptions? options = null, DocumentMetadata? metadata = null)
	{
		var doc = new Document
		{
			Metadata = metadata ?? new DocumentMetadata(),
			Pages = new[] { new Page { Content = content } },
		};
		var renderer = options != null ? new PdfRenderer(options) : new PdfRenderer();
		return renderer.Render(doc);
	}

	[Fact]
	public void Rendered_pdf_starts_with_pdf_header()
	{
		var bytes = RenderScene(new GroupElement());
		Assert.True(bytes.Length > 4);
		Assert.Equal((byte)'%', bytes[0]);
		Assert.Equal((byte)'P', bytes[1]);
		Assert.Equal((byte)'D', bytes[2]);
		Assert.Equal((byte)'F', bytes[3]);
	}

	[Fact]
	public void Empty_document_produces_one_blank_page()
	{
		var bytes = RenderScene(new GroupElement());
		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Single_path_renders_and_reopens()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(10, 0).LineTo(10, 5).Close().Build();
		var bytes = RenderScene(new PathElement { Path = path });

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Filled_surface_renders_with_fill_brush()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(20, 0).LineTo(20, 10).LineTo(0, 10).Close().Build();
		var bytes = RenderScene(new PathElement
		{
			Path = path,
			Stroke = new Stroke { Color = Color.Black, Width = 0.25 },
			Fill = new Fill { Color = Color.Rgb((byte)200, (byte)200, (byte)200) },
		});
		Assert.NotEmpty(bytes);
		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Text_element_renders()
	{
		var text = new TextElement
		{
			Text = "Hello",
			Position = new Point2D(10, 10),
			Style = new TextStyle { FontSize = 3.0, HorizontalAnchor = TextAnchor.Center },
			MeasuredBounds = new BoundingBox(0, 8, 20, 13),
		};
		var bytes = RenderScene(text);
		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Linear_dimension_renders()
	{
		var bytes = RenderScene(new DimensionElement
		{
			Kind = DimensionKind.Linear,
			A = new Point2D(0, 0),
			B = new Point2D(100, 0),
			Offset = 10,
			Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.25 },
		});

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Angular_dimension_renders()
	{
		var bytes = RenderScene(new DimensionElement
		{
			Kind = DimensionKind.Angular,
			Vertex = new Point2D(0, 0),
			A = new Point2D(50, 0),
			B = new Point2D(0, 50),
			Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.25 },
		});

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Combined_scene_renders()
	{
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(50, 0).LineTo(50, 25).LineTo(0, 25).Close().Build();
		var content = new GroupElement
		{
			Children = new DrawElement[]
			{
				new PathElement { Path = path },
				new DimensionElement
				{
					Kind = DimensionKind.Linear,
					A = new Point2D(0, 0),
					B = new Point2D(50, 0),
					Offset = -8,
					Style = new DimensionStyle { TextSize = 2.5, StrokeWidth = 0.25 },
				},
				new TextElement
				{
					Text = "Plate",
					Position = new Point2D(25, 12.5),
					Style = new TextStyle { FontSize = 3.0, HorizontalAnchor = TextAnchor.Center },
					MeasuredBounds = new BoundingBox(20, 11, 30, 14),
				},
			},
		};

		var bytes = RenderScene(content);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(1, reopened.PageCount);
	}

	[Fact]
	public void Document_metadata_round_trips_through_info_dictionary()
	{
		var meta = new DocumentMetadata
		{
			Title = "Bracket Assembly",
			Author = "Felix",
			Subject = "Mechanical drawing",
			Creator = "Selva",
			Producer = "Selva.Drawing",
			Keywords = new[] { "bracket", "assembly", "test" },
			CreatedAt = new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc),
		};
		var bytes = RenderScene(new GroupElement(), metadata: meta);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal("Bracket Assembly", reopened.Info.Title);
		Assert.Equal("Felix", reopened.Info.Author);
		Assert.Equal("Mechanical drawing", reopened.Info.Subject);
		Assert.Equal("Selva", reopened.Info.Creator);
		Assert.Equal("bracket; assembly; test", reopened.Info.Keywords);
	}

	[Fact]
	public void Auto_fit_sets_page_size_to_content_plus_padding()
	{
		// Content spans 0..100 × 0..50 mm; default padding is 10 → page should be 120 × 70 mm.
		var path = new Path.Builder()
			.MoveTo(0, 0).LineTo(100, 0).LineTo(100, 50).LineTo(0, 50).Close().Build();
		var bytes = RenderScene(new PathElement { Path = path });

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var page = reopened.Pages[0];

		// 1 mm = 72/25.4 pt ≈ 2.83465 pt. Allow 0.1 pt slack.
		const double mmToPt = 72.0 / 25.4;
		Assert.InRange(page.Width.Point, 120 * mmToPt - 0.1, 120 * mmToPt + 0.1);
		Assert.InRange(page.Height.Point, 70 * mmToPt - 0.1, 70 * mmToPt + 0.1);
	}

	[Fact]
	public void Paper_size_mode_uses_page_size_when_auto_fit_disabled()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Size = PaperSize.A4, Content = new GroupElement() },
			},
		};
		var renderer = new PdfRenderer(new PdfRenderOptions { AutoFitToContent = false });
		var bytes = renderer.Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var page = reopened.Pages[0];

		const double mmToPt = 72.0 / 25.4;
		Assert.InRange(page.Width.Point, 210 * mmToPt - 0.1, 210 * mmToPt + 0.1);
		Assert.InRange(page.Height.Point, 297 * mmToPt - 0.1, 297 * mmToPt + 0.1);
	}

	[Fact]
	public void Renderer_is_idempotent_across_calls()
	{
		// PdfFontEmbedder installs the font resolver lazily on first Render(); subsequent
		// renders must not throw when the resolver is already pinned in place.
		var renderer = new PdfRenderer();
		var doc = new Document { Pages = new[] { new Page { Content = new GroupElement() } } };
		var first = renderer.Render(doc);
		var second = new PdfRenderer().Render(doc);
		Assert.NotEmpty(first);
		Assert.NotEmpty(second);
	}
}
