using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.Drawing.Rendering.Pdf;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Rendering.Pdf;

// Phase 9: PDF outlines (bookmarks) provide a navigable sidebar in viewers. The renderer
// emits one top-level outline per Page (using Page.Title or "Page N" when blank) plus
// nested entries for any DrawingView whose Caption is set.
public class PdfOutlinesTests
{
	[Fact]
	public void Renderer_emits_one_top_level_outline_per_page()
	{
		var doc = new Document
		{
			Pages = new[]
			{
				new Page { Title = "Cover", Content = new GroupElement() },
				new Page { Title = "Details", Content = new GroupElement() },
				new Page { Content = new GroupElement() },
			},
		};
		var bytes = new PdfRenderer().Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Equal(3, reopened.Outlines.Count);
		Assert.Equal("Cover", reopened.Outlines[0].Title);
		Assert.Equal("Details", reopened.Outlines[1].Title);
		// Untitled pages get an auto-generated label.
		Assert.Equal("Page 3", reopened.Outlines[2].Title);
	}

	[Fact]
	public void DrawingView_captions_become_nested_outlines()
	{
		var dv1 = new DrawingView
		{
			Geometry = new PathElement
			{
				Path = new Path.Builder().MoveTo(0, 0).LineTo(20, 0).LineTo(20, 20).Close().Build(),
			},
			Scale = 1.0,
			Caption = "VIEW A",
			Origin = new Point2D(0, 50),
		};
		var dv2 = new DrawingView
		{
			Geometry = new PathElement
			{
				Path = new Path.Builder().MoveTo(0, 0).LineTo(20, 0).LineTo(20, 20).Close().Build(),
			},
			Scale = 0.5,
			Caption = "VIEW B",
			Origin = new Point2D(50, 50),
		};

		var doc = new Document
		{
			Pages = new[]
			{
				new Page
				{
					Title = "Sheet 1",
					Content = new GroupElement { Children = new DrawElement[] { dv1, dv2 } },
				},
			},
		};

		var bytes = new PdfRenderer().Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		var top = Assert.Single(reopened.Outlines);
		Assert.Equal("Sheet 1", top.Title);
		Assert.Collection(top.Outlines,
			o => Assert.Equal("VIEW A", o.Title),
			o => Assert.Equal("VIEW B", o.Title));
	}

	[Fact]
	public void Disable_outlines_skips_emission()
	{
		var doc = new Document
		{
			Pages = new[] { new Page { Title = "Cover", Content = new GroupElement() } },
		};
		var bytes = new PdfRenderer(new PdfRenderOptions { EmitOutlines = false }).Render(doc);

		using var ms = new MemoryStream(bytes);
		using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
		Assert.Empty(reopened.Outlines);
	}
}
