using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class PaginationPassTests
{
	private static readonly PaperSize TenByTen = new PaperSize(10, 10, "T10");
	private static readonly Margins NoMargin = Margins.Zero;

	[Fact]
	public void Null_content_emits_one_empty_page()
	{
		var pages = PaginationPass.Paginate(null, TenByTen, NoMargin);
		Assert.Single(pages);
		Assert.Null(pages[0].Content);
		Assert.Equal(TenByTen, pages[0].Size);
	}

	[Fact]
	public void Primitive_that_fits_emits_single_page()
	{
		var pages = PaginationPass.Paginate(Rect(5, 5), TenByTen, NoMargin);
		Assert.Single(pages);
	}

	[Fact]
	public void Oversize_primitive_still_emits_one_page_for_forward_progress()
	{
		// 20mm tall primitive on a 10mm-tall page: cannot split, but pagination must
		// terminate. The element gets force-placed on a single page.
		var pages = PaginationPass.Paginate(Rect(5, 20), TenByTen, NoMargin);
		Assert.Single(pages);
	}

	[Fact]
	public void Vertical_stack_splits_between_children_across_pages()
	{
		// Five 3mm rects (zero spacing) on a 10mm-tall page: rects 1-3 fit (9mm), rest spill.
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin);
		Assert.Equal(2, pages.Count);
	}

	[Fact]
	public void Vertical_stack_with_spacing_accounts_for_inter_child_gaps()
	{
		// Four 3mm rects + 3 × 1mm spacing = 12 + 3 = 15mm total. Page is 10mm tall.
		// First page fits rects + spacing within budget: 3 + 1 + 3 + 1 + 3 = 11 → only 2 fit
		// (3 + 1 + 3 = 7), third would push to 11 > 10. Remaining 2 spill onto page 2 (7mm).
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 1,
			Children = new DrawElement[] { Rect(2, 3), Rect(2, 3), Rect(2, 3), Rect(2, 3) },
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin);
		Assert.Equal(2, pages.Count);
	}

	[Fact]
	public void First_page_content_is_anchored_top_left_of_content_rect()
	{
		// 20mm × 20mm paper, 5mm margin → content rect (5,5)-(15,15). A 4mm-tall rect should
		// sit with its TOP at y=15, LEFT at x=5.
		var paper = new PaperSize(20, 20, "T20");
		var margins = Margins.Uniform(5);
		var content = Rect(4, 4);
		var pages = PaginationPass.Paginate(content, paper, margins);
		Assert.Single(pages);

		var bounds = pages[0].Content.ComputeBounds();
		Assert.Equal(5, bounds.MinX, 6);
		Assert.Equal(11, bounds.MinY, 6);
		Assert.Equal(15, bounds.MaxY, 6);
	}

	[Fact]
	public void Single_child_that_exactly_fills_one_page_does_not_emit_an_empty_second_page()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			Children = new DrawElement[] { Rect(2, 5), Rect(2, 5) },
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin);
		Assert.Single(pages);
	}

	[Fact]
	public void Horizontal_stack_is_atomic_and_emits_one_page_when_it_fits()
	{
		var stack = new Stack
		{
			Orientation = StackOrientation.Horizontal,
			Children = new DrawElement[] { Rect(2, 4), Rect(2, 4) },
		};
		var pages = PaginationPass.Paginate(stack, TenByTen, NoMargin);
		Assert.Single(pages);
	}

	private static PathElement Rect(double w, double h) =>
		new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(w, 0).LineTo(w, h).LineTo(0, h).Close().Build(),
		};
}
