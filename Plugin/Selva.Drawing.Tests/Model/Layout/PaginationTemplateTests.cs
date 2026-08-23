using System.Collections.Generic;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class PaginationTemplateTests
{
	private static readonly PaperSize TenByTen = new PaperSize(10, 10, "T10");
	private static readonly Margins NoMargin = Margins.Zero;

	[Fact]
	public void Header_height_shrinks_content_rect_so_more_pages_are_emitted()
	{
		// Three 3mm rects on a 10mm tall page with no chrome → all three fit (9mm) on one page.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var withoutTemplate = PaginationPass.Paginate(stack, TenByTen, NoMargin);
		Assert.Single(withoutTemplate);

		// Same content with a 5mm header in Content placement shrinks the content rect to
		// 5mm, so only one rect fits per page → three pages.
		var template = new PageTemplate
		{
			HeaderHeight = 5,
			HeaderPlacement = ChromePlacement.Content,
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin, template);
		Assert.Equal(3, pages.Count);
	}

	[Fact]
	public void Header_text_with_page_token_substitutes_per_page()
	{
		var headerText = new TextElement
		{
			Text = "Page {page} of {pages}",
			Position = new Point2D(0, 5),
		};
		// Explicit bounds so PaginationPass measures the header independent of font metrics
		// that vary by platform.
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 2),
		};

		// Content placement makes the header reserve space, forcing the rects onto separate
		// pages — default Margin placement would let all three fit on one page.
		var template = new PageTemplate
		{
			Header = header,
			HeaderHeight = 2,
			HeaderPlacement = ChromePlacement.Content,
		};
		// 8mm content rect (10mm page - 2mm header). Three 5mm rects → only one per page.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 5), Rect(2, 5), Rect(2, 5) },
		};

		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin, template);
		Assert.Equal(3, pages.Count);

		var headerTexts = new List<string>();
		for (var i = 0; i < pages.Count; i++)
			headerTexts.Add(FindFirstText(pages[i].Content)!);

		Assert.Equal("Page 1 of 3", headerTexts[0]);
		Assert.Equal("Page 2 of 3", headerTexts[1]);
		Assert.Equal("Page 3 of 3", headerTexts[2]);
	}

	[Fact]
	public void Title_flows_through_to_Page_Title()
	{
		var template = new PageTemplate { Title = "Q2 Report" };
		var pages = PaginationPass.Paginate(Rect(2, 3), TenByTen, NoMargin, template);
		Assert.Equal("Q2 Report", pages[0].Title);
	}

	[Fact]
	public void Title_token_in_header_substitutes()
	{
		var headerText = new TextElement { Text = "{title}", Position = Point2D.Zero };
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 2),
		};
		var template = new PageTemplate { Title = "Hello", Header = header, HeaderHeight = 2 };
		var pages = PaginationPass.Paginate(Rect(2, 3), TenByTen, NoMargin, template);
		Assert.Equal("Hello", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Footer_in_margin_placement_is_anchored_below_the_page_rect()
	{
		// 20×20 paper, 5mm margin → page rect (5,5)-(15,15). Default Margin placement puts a
		// 3mm footer flush with the bottom paper edge, hanging into the margin (y=0..3). The
		// body keeps the full content rect.
		var paper = new PaperSize(20, 20, "T20");
		var margins = Margins.Uniform(5);
		var footer = new GroupElement
		{
			Children = new DrawElement[] { Rect(2, 3) },
			BoundsOverride = new BoundingBox(0, 0, 2, 3),
		};
		var template = new PageTemplate { Footer = footer, FooterHeight = 3 };

		var pages = PaginationPass.Paginate(Rect(4, 4), paper, margins, template);
		Assert.Single(pages);

		var pageBounds = pages[0].Content.ComputeBounds();
		// Footer bottom is at y=0 (paper edge); body's top is at y=15 (page rect top).
		Assert.Equal(0, pageBounds.MinY, 6);
		Assert.Equal(15, pageBounds.MaxY, 6);
	}

	[Fact]
	public void Footer_in_content_placement_sits_at_bottom_of_page_rect()
	{
		// Same setup, but Content placement makes the footer reserve space inside the page
		// rect instead, sitting at y=5..8.
		var paper = new PaperSize(20, 20, "T20");
		var margins = Margins.Uniform(5);
		var footer = new GroupElement
		{
			Children = new DrawElement[] { Rect(2, 3) },
			BoundsOverride = new BoundingBox(0, 0, 2, 3),
		};
		var template = new PageTemplate
		{
			Footer = footer,
			FooterHeight = 3,
			FooterPlacement = ChromePlacement.Content,
		};

		var pages = PaginationPass.Paginate(Rect(4, 4), paper, margins, template);
		Assert.Single(pages);

		var pageBounds = pages[0].Content.ComputeBounds();
		Assert.Equal(5, pageBounds.MinY, 6);
		Assert.Equal(15, pageBounds.MaxY, 6);
	}

	[Fact]
	public void Footer_in_edge_placement_shrinks_body_when_band_intrudes_into_content_rect()
	{
		// 20×20 paper, 3mm margin → page rect (3,3)-(17,17). Footer: EdgeOffset=2, height=4 →
		// band occupies y=2..6, extending 3mm into the content rect (2+4-3=3), so the content
		// rect is shrunk from the bottom and its bottom edge rises to y=6. A band that fits
		// fully within the margin (offset+height ≤ margin) should leave the body untouched.
		var paper = new PaperSize(20, 20, "T20");
		var margins = Margins.Uniform(3);
		var footer = new GroupElement
		{
			Children = new DrawElement[] { Rect(2, 4) },
			BoundsOverride = new BoundingBox(0, 0, 2, 4),
		};
		var template = new PageTemplate
		{
			Footer = footer,
			FooterHeight = 4,
			FooterPlacement = ChromePlacement.Edge,
			FooterEdgeOffset = 2,
		};

		// reserve = max(0, 2+4-3) = 3 → content rect bottom at 3+3 = 6
		var body = PaginationPass.PaginateBody(Rect(4, 4), paper, margins, new BandConfig
		{
			FooterHeight = 4,
			FooterPlacement = ChromePlacement.Edge,
			FooterEdgeOffset = 2,
		});
		Assert.Equal(6, body.ContentRect.MinY, 6);

		// Band within margin (offset=1, height=2, margin=3 → reserve=0) → body unaffected.
		var bodyNoShrink = PaginationPass.PaginateBody(Rect(4, 4), paper, margins, new BandConfig
		{
			FooterHeight = 2,
			FooterPlacement = ChromePlacement.Edge,
			FooterEdgeOffset = 1,
		});
		Assert.Equal(3, bodyNoShrink.ContentRect.MinY, 6);
	}

	[Fact]
	public void Header_without_explicit_height_is_measured_from_bounds()
	{
		// Header is 4mm tall with no explicit HeaderHeight, so it's measured. Content rect is
		// 6mm (10mm page - 4mm header); two 3mm rects fit on page 1, rest spill.
		var header = new GroupElement
		{
			Children = new DrawElement[] { Rect(2, 4) },
			BoundsOverride = new BoundingBox(0, 0, 2, 4),
		};
		// Content placement so the auto-measured header height shrinks the content rect.
		var template = new PageTemplate
		{
			Header = header,
			HeaderPlacement = ChromePlacement.Content,
		};

		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin, template);
		Assert.Equal(2, pages.Count);
	}

	[Fact]
	public void Empty_content_with_template_still_emits_one_page_with_chrome()
	{
		var headerText = new TextElement { Text = "{page}/{pages}", Position = Point2D.Zero };
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 2),
		};
		var template = new PageTemplate { Header = header, HeaderHeight = 2 };
		var pages = PaginationPass.Paginate(null, TenByTen, NoMargin, template);
		Assert.Single(pages);
		Assert.Equal("1/1", FindFirstText(pages[0].Content));
	}

	[Fact]
	public void Wrapping_header_reserves_its_full_wrapped_height()
	{
		// A header TextFlow longer than the band width wraps to multiple lines. The reserved
		// band must be measured at that same width — an unconstrained measure would see a
		// single line and let the header's extra lines overlap the body on every page.
		var paper = new PaperSize(100, 100, "T100");
		var margins = Margins.Uniform(10); // band width 80
		var header = new Selva.Drawing.Model.Layout.TextFlow
		{
			Text = "the quick brown fox jumps over the lazy dog and then jumps back again " +
				"over the lazy dog and keeps going well past the band width",
			Style = new Selva.Drawing.Model.Style.TextStyle { FontSize = 3.0 },
		};
		var template = new PageTemplate
		{
			Header = header,
			HeaderPlacement = ChromePlacement.Content,
		};

		var pages = PaginationPass.Paginate(Rect(20, 30), paper, margins, template);
		var page = Assert.IsType<GroupElement>(pages[0].Content);
		Assert.Equal(2, page.Children.Count);

		var headerBounds = page.Children[0].ComputeBounds();
		var bodyBounds = page.Children[1].ComputeBounds();

		// Sanity: the header really wrapped (taller than one ~3.6mm line).
		Assert.True(headerBounds.Height > 5,
			$"header height {headerBounds.Height} — expected a multi-line wrap");
		// The wrapped header must sit entirely above the body.
		Assert.True(headerBounds.MinY >= bodyBounds.MaxY - 1e-6,
			$"header bottom {headerBounds.MinY} overlaps body top {bodyBounds.MaxY}");
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};

	private static string? FindFirstText(DrawElement element)
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
