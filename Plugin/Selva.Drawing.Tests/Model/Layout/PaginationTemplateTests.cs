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

		// Same content with a 5mm header — content rect is now 5mm tall, so only one rect fits
		// per page → three pages.
		var template = new PageTemplate { HeaderHeight = 5 };
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
		// Wrap the header in a group with explicit bounds so PaginationPass measures it
		// independently of font metrics that vary by platform.
		var header = new GroupElement
		{
			Children = new DrawElement[] { headerText },
			BoundsOverride = new BoundingBox(0, 0, 10, 2),
		};

		var template = new PageTemplate { Header = header, HeaderHeight = 2 };
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
			headerTexts.Add(FindFirstText(pages[i].Content));

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
	public void Footer_anchored_to_bottom_of_page_content_rect()
	{
		// 20×20 paper, 5mm margin → page rect (5,5)-(15,15). Footer 3mm tall sits at the bottom.
		// With no header, content rect = (5,8)-(15,15).
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

		// Footer's bounds within the composed page should sit at y in [5, 8].
		var pageBounds = pages[0].Content.ComputeBounds();
		Assert.Equal(5, pageBounds.MinY, 6);
		// Top of full content (header missing → content at top, footer at bottom). Top edge is 15.
		Assert.Equal(15, pageBounds.MaxY, 6);
	}

	[Fact]
	public void Header_without_explicit_height_is_measured_from_bounds()
	{
		// Header is 4mm tall, no explicit HeaderHeight → measured. Page is 10mm → content rect
		// is 6mm. Two 3mm rects fit on page 1; rest spill.
		var header = new GroupElement
		{
			Children = new DrawElement[] { Rect(2, 4) },
			BoundsOverride = new BoundingBox(0, 0, 2, 4),
		};
		var template = new PageTemplate { Header = header };

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

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};

	// Walks the resolved page tree and returns the Text of the first TextElement encountered.
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
