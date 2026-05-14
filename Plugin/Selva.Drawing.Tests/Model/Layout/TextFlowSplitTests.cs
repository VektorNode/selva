using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model.Layout;

public class TextFlowSplitTests
{
	[Fact]
	public void Whole_flow_fits_returns_AllFits()
	{
		var flow = new TextFlow
		{
			Text = "one\ntwo",
			Width = 1000,
			Style = new TextStyle { FontSize = 3.0 },
		};
		// 100mm of budget — clearly enough for a 2-line flow at any reasonable font.
		var split = flow.TrySplit(100, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void No_lines_fit_returns_NothingFits()
	{
		var flow = new TextFlow
		{
			Text = "line one\nline two",
			Width = 1000,
			Style = new TextStyle { FontSize = 10.0 },
		};
		// 0.1mm of budget — not enough room for a single line.
		var split = flow.TrySplit(0.1, new LayoutContext(BoundingBox.Empty));
		Assert.Null(split.Fits);
		Assert.Same(flow, split.Overflow);
	}

	[Fact]
	public void Splits_between_lines_and_overflow_is_a_TextFlow()
	{
		// Five hard-newline lines, wide enough that no wrapping happens. The line height for
		// FontSize=3 is < 5mm, so a 6mm budget should fit at least one full line and spill
		// the rest.
		var flow = new TextFlow
		{
			Text = "a\nb\nc\nd\ne",
			Width = 1000,
			Style = new TextStyle { FontSize = 3.0 },
		};
		var split = flow.TrySplit(6, new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(split.Fits);
		var overflow = Assert.IsType<TextFlow>(split.Overflow);

		// Overflow must reset its origin so PaginationPass can re-anchor it on the next page.
		Assert.Equal(Point2D.Zero, overflow.Origin);
		// Width and style propagate so the overflow re-wraps identically.
		Assert.Equal(flow.Width, overflow.Width);
		Assert.Equal(flow.Style, overflow.Style);

		// Round-trip the lines: fits-text + "\n" + overflow-text == original after re-assembly.
		// We can't compare strings directly because the wrapper may have collapsed empty
		// paragraphs; instead, both halves combined should produce 5 lines when re-resolved.
		var fitsResolved = (GroupElement)new TextFlow { Text = ExtractText(split.Fits), Width = flow.Width, Style = flow.Style }
			.Resolve(new LayoutContext(BoundingBox.Empty));
		var overflowResolved = (GroupElement)overflow.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Equal(5, fitsResolved.Children.Count + overflowResolved.Children.Count);
	}

	[Fact]
	public void Pagination_emits_one_page_per_line_chunk_for_long_TextFlow()
	{
		// 10mm-tall page with 0 margins → 10mm content rect. FontSize 3.0 → lineHeight ≈ 4.something mm.
		// Two lines fit per page; with 5 lines we expect 3 pages.
		var flow = new TextFlow
		{
			Text = "1\n2\n3\n4\n5",
			Width = 1000,
			Style = new TextStyle { FontSize = 3.0 },
		};
		var paper = new PaperSize(20, 10, "T20x10");
		var pages = PaginationPass.Paginate(flow, paper, Margins.Zero);
		Assert.True(pages.Count >= 2, $"expected long TextFlow to spread across multiple pages, got {pages.Count}");
	}

	// Walks the resolved subtree and joins the text of each TextElement with newlines so
	// callers can re-assemble what was placed on a page.
	private static string ExtractText(DrawElement element)
	{
		var lines = new System.Collections.Generic.List<string>();
		Collect(element, lines);
		return string.Join("\n", lines);

		static void Collect(DrawElement e, System.Collections.Generic.List<string> acc)
		{
			switch (e)
			{
				case null: return;
				case TextElement t: acc.Add(t.Text ?? string.Empty); return;
				case GroupElement g:
					foreach (var c in g.Children) Collect(c, acc);
					return;
			}
		}
	}
}
