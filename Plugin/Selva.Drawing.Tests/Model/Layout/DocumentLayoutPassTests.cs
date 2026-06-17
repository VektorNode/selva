using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class DocumentLayoutPassTests
{
	private static readonly PaperSize TenByTen = new PaperSize(10, 10, "T10");
	private static readonly Margins NoMargin = Margins.Zero;

	[Fact]
	public void Empty_document_with_no_sections_emits_one_chrome_only_page()
	{
		var layout = new DocumentLayout
		{
			Sections = System.Array.Empty<Section>(),
			PaperSize = TenByTen,
			Margins = NoMargin,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Single(pages);
	}

	[Fact]
	public void Page_numbering_is_global_across_sections()
	{
		// Section A: 2 × 5mm rects on a 10mm page → 2 pages.
		// Section B: 3 × 4mm rects on a 10mm page (no spacing) → 2 pages (rects 1-2 fit = 8mm,
		// rect 3 spills onto a second page). Total = 4 pages.
		var sectionA = new Section
		{
			Content = new Stack
			{
				Orientation = StackOrientation.Vertical,
				Spacing = 0,
				Children = new DrawElement[] { Rect(2, 6), Rect(2, 6) },
			},
			Title = "A",
		};
		var sectionB = new Section
		{
			Content = new Stack
			{
				Orientation = StackOrientation.Vertical,
				Spacing = 0,
				Children = new DrawElement[] { Rect(2, 4), Rect(2, 4), Rect(2, 4) },
			},
			Title = "B",
		};

		var headerText = new TextElement { Text = "{page}/{pages}", Position = Point2D.Zero };
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 0),
		};

		var layout = new DocumentLayout
		{
			Sections = new[] { sectionA, sectionB },
			PaperSize = TenByTen,
			Margins = NoMargin,
			Header = header,
			HeaderHeight = 1,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal(4, pages.Count);

		// Footer / header must read "1/4", "2/4", "3/4", "4/4".
		Assert.Equal("1/4", FindFirstText(pages[0].Content));
		Assert.Equal("2/4", FindFirstText(pages[1].Content));
		Assert.Equal("3/4", FindFirstText(pages[2].Content));
		Assert.Equal("4/4", FindFirstText(pages[3].Content));
	}

	[Fact]
	public void Section_token_resolves_to_current_pages_section_title()
	{
		var sectionA = new Section
		{
			Content = Rect(2, 5),
			Title = "Cover",
		};
		var sectionB = new Section
		{
			Content = Rect(2, 5),
			Title = "Body",
		};

		var headerText = new TextElement { Text = "{section}", Position = Point2D.Zero };
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 0),
		};

		var layout = new DocumentLayout
		{
			Sections = new[] { sectionA, sectionB },
			PaperSize = TenByTen,
			Margins = NoMargin,
			Header = header,
			HeaderHeight = 1,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal(2, pages.Count);
		Assert.Equal("Cover", FindFirstText(pages[0].Content));
		Assert.Equal("Body", FindFirstText(pages[1].Content));
	}

	[Fact]
	public void Section_header_overrides_doc_header_for_that_sections_pages()
	{
		var docHeaderText = new TextElement { Text = "doc", Position = Point2D.Zero };
		var docHeader = new GroupElement
		{
			Children = new DrawElement[] { docHeaderText },
			BoundsOverride = new BoundingBox(0, 0, 10, 0),
		};

		var sectionHeaderText = new TextElement { Text = "section-A", Position = Point2D.Zero };
		var sectionHeader = new GroupElement
		{
			Children = new DrawElement[] { sectionHeaderText },
			BoundsOverride = new BoundingBox(0, 0, 10, 0),
		};

		var sectionA = new Section
		{
			Content = Rect(2, 5),
			Header = sectionHeader,
			Title = "A",
		};
		var sectionB = new Section
		{
			Content = Rect(2, 5),
			Title = "B",
		};

		var layout = new DocumentLayout
		{
			Sections = new[] { sectionA, sectionB },
			PaperSize = TenByTen,
			Margins = NoMargin,
			Header = docHeader,
			HeaderHeight = 1,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal(2, pages.Count);
		Assert.Equal("section-A", FindFirstText(pages[0].Content));
		Assert.Equal("doc", FindFirstText(pages[1].Content));
	}

	[Fact]
	public void Section_with_keep_together_emits_one_page_even_when_content_overflows()
	{
		// Five 3mm rects = 15mm; page is 10mm. Without keep-together → 2 pages. With → 1 page.
		var content = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var section = new Section { Content = content, KeepTogether = true };
		var layout = new DocumentLayout
		{
			Sections = new[] { section },
			PaperSize = TenByTen,
			Margins = NoMargin,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Single(pages);
	}

	[Fact]
	public void Section_with_null_paper_size_inherits_document_default()
	{
		var section = new Section { Content = Rect(2, 5), Title = "S" };
		var layout = new DocumentLayout
		{
			Sections = new[] { section },
			PaperSize = TenByTen,
			Margins = NoMargin,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Single(pages);
		Assert.Equal(TenByTen, pages[0].Size);
	}

	[Fact]
	public void Section_with_overridden_paper_size_uses_its_own_paper()
	{
		var bigPaper = new PaperSize(20, 20, "T20");
		var sectionA = new Section { Content = Rect(2, 5), PaperSize = bigPaper };
		var sectionB = new Section { Content = Rect(2, 5) };
		var layout = new DocumentLayout
		{
			Sections = new[] { sectionA, sectionB },
			PaperSize = TenByTen,
			Margins = NoMargin,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal(2, pages.Count);
		Assert.Equal(bigPaper, pages[0].Size);
		Assert.Equal(TenByTen, pages[1].Size);
	}

	[Fact]
	public void Document_user_tokens_substitute_in_chrome()
	{
		var headerText = new TextElement { Text = "{author}", Position = Point2D.Zero };
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 0),
		};
		var section = new Section { Content = Rect(2, 5) };
		var layout = new DocumentLayout
		{
			Sections = new[] { section },
			PaperSize = TenByTen,
			Margins = NoMargin,
			Header = header,
			HeaderHeight = 1,
			Tokens = new Dictionary<string, string> { ["author"] = "Felix" },
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal("Felix", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Scale_token_auto_fills_from_a_single_views_inferred_scale()
	{
		// 100mm geometry pinned to 20mm → 1:5.
		var view = new Selva.Drawing.Model.Drawings.DrawingView
		{
			Geometry = Rect(100, 50),
			Length = 20,
		};
		var header = ScaleHeader();
		var layout = new DocumentLayout
		{
			Sections = new[] { new Section { Content = view } },
			PaperSize = new PaperSize(300, 300, "T300"),
			Margins = NoMargin,
			Header = header,
			HeaderHeight = 5,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal("1:5", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Scale_token_reads_as_shown_when_views_differ()
	{
		var view5 = new Selva.Drawing.Model.Drawings.DrawingView { Geometry = Rect(100, 50), Length = 20 }; // 1:5
		var view2 = new Selva.Drawing.Model.Drawings.DrawingView { Geometry = Rect(100, 50), Length = 50 }; // 1:2
		var content = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { view5, view2 },
		};
		var layout = new DocumentLayout
		{
			Sections = new[] { new Section { Content = content, KeepTogether = true } },
			PaperSize = new PaperSize(300, 300, "T300"),
			Margins = NoMargin,
			Header = ScaleHeader(),
			HeaderHeight = 5,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Single(pages);
		Assert.Equal("As shown", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Explicit_scale_token_is_not_overwritten_by_inference()
	{
		var view = new Selva.Drawing.Model.Drawings.DrawingView { Geometry = Rect(100, 50), Length = 20 };
		var layout = new DocumentLayout
		{
			Sections = new[] { new Section { Content = view } },
			PaperSize = new PaperSize(300, 300, "T300"),
			Margins = NoMargin,
			Header = ScaleHeader(),
			HeaderHeight = 5,
			Tokens = new Dictionary<string, string> { ["scale"] = "1:100" },
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal("1:100", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Unfilled_scale_token_renders_blank_not_the_literal_token()
	{
		// No DrawingView on the page and no doc-level {scale} → {scale} resolves to empty.
		var layout = new DocumentLayout
		{
			Sections = new[] { new Section { Content = Rect(2, 5) } },
			PaperSize = new PaperSize(300, 300, "T300"),
			Margins = NoMargin,
			Header = ScaleHeader(),
			HeaderHeight = 5,
		};
		var pages = DocumentLayoutPass.Paginate(layout);
		Assert.Equal("", FindFirstText(pages[0].Content));
	}

	private static GroupElement ScaleHeader() => new GroupElement
	{
		Children = new DrawElement[] { new TextElement { Text = "{scale}", Position = Point2D.Zero } },
		BoundsOverride = new BoundingBox(0, 0, 10, 0),
	};

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};

	private static string FindFirstText(DrawElement element)
	{
		switch (element)
		{
			case null: return null;
			case TextElement t: return t.Text;
			case GroupElement g:
				foreach (var c in g.Children)
				{
					var v = FindFirstText(c);
					if (v != null) return v;
				}
				return null;
			default: return null;
		}
	}
}
