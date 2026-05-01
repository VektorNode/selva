using System.Collections.Generic;
using System.Linq;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Model.Layout;

public class TableSplitTests
{
	[Fact]
	public void All_rows_fit_returns_AllFits()
	{
		var table = MakeTable(header: null, rowHeights: new[] { 3.0, 3.0, 3.0 });
		var split = table.TrySplit(20, ContextWithHeight(20));
		Assert.NotNull(split.Fits);
		Assert.Null(split.Overflow);
	}

	[Fact]
	public void Splits_between_rows_with_no_header()
	{
		// 3 rows of 5mm, budget 12mm → first 2 fit (10mm), 1 spills.
		var table = MakeTable(header: null, rowHeights: new[] { 5.0, 5.0, 5.0 });
		var split = table.TrySplit(12, ContextWithHeight(12));
		Assert.NotNull(split.Fits);
		var overflow = Assert.IsType<Table>(split.Overflow);
		Assert.Null(overflow.Header);
		Assert.Single(overflow.Rows);
	}

	[Fact]
	public void Header_repeats_on_overflow_table()
	{
		// 2mm header + 3 rows of 5mm. Budget 12mm: header(2) + 2 rows(10) = 12 fits, 1 spills.
		// The overflow table must carry the same header so it repeats on the next page.
		var table = MakeTable(header: 2.0, rowHeights: new[] { 5.0, 5.0, 5.0 });
		var split = table.TrySplit(12, ContextWithHeight(12));
		Assert.NotNull(split.Fits);
		var overflow = Assert.IsType<Table>(split.Overflow);
		Assert.NotNull(overflow.Header);
		Assert.Single(overflow.Header);
		Assert.Single(overflow.Rows);
	}

	[Fact]
	public void Returns_NothingFits_when_header_alone_doesnt_fit()
	{
		var table = MakeTable(header: 10.0, rowHeights: new[] { 3.0, 3.0 });
		var split = table.TrySplit(5, ContextWithHeight(5));
		Assert.Null(split.Fits);
		Assert.Same(table, split.Overflow);
	}

	[Fact]
	public void Returns_NothingFits_when_header_fits_but_no_row_does()
	{
		// Header(5) fits in 8mm but next row(6) doesn't. We avoid emitting a header-only page
		// (no forward progress on data) and defer the whole table.
		var table = MakeTable(header: 5.0, rowHeights: new[] { 6.0 });
		var split = table.TrySplit(8, ContextWithHeight(8));
		Assert.Null(split.Fits);
		Assert.Same(table, split.Overflow);
	}

	[Fact]
	public void Pagination_emits_one_page_per_chunk_with_header_repeated()
	{
		// Page 20×10, no margins → content rect 10mm tall. Header 2mm + 5 rows of 4mm.
		// Each page: header(2) + 2 rows(8) = 10. 5 rows → 2 + 2 + 1 = 3 pages.
		var table = MakeTable(header: 2.0, rowHeights: new[] { 4.0, 4.0, 4.0, 4.0, 4.0 });
		var paper = new PaperSize(20, 10, "T20x10");
		var pages = PaginationPass.Paginate(table, paper, Margins.Zero);
		Assert.Equal(3, pages.Count);
	}

	[Fact]
	public void Pagination_force_places_table_when_header_taller_than_page()
	{
		// Header alone is bigger than the whole page. Forward-progress guarantee force-places
		// the whole table on a single page (overflowing the paper) rather than looping.
		var table = MakeTable(header: 15.0, rowHeights: new[] { 4.0, 4.0 });
		var paper = new PaperSize(20, 10, "T20x10");
		var pages = PaginationPass.Paginate(table, paper, Margins.Zero);
		Assert.Single(pages);
	}

	private static Table MakeTable(double? header, double[] rowHeights)
	{
		IReadOnlyList<TableCell> headerCells = header.HasValue
			? new[] { CellElement(width: 5, height: header.Value) }
			: null;
		var rows = rowHeights
			.Select(h => (IReadOnlyList<TableCell>)new[] { CellElement(width: 5, height: h) })
			.ToArray();
		return new Table
		{
			ColumnWidths = new[] { GridLength.Absolute(5) },
			Header = headerCells,
			Rows = rows,
			CellPadding = Margins.Zero,
			Border = null,
		};
	}

	private static TableCell CellElement(double width, double height) => new TableCell
	{
		Element = new PathElement
		{
			Path = new Path.Builder()
				.MoveTo(0, 0).LineTo(width, 0).LineTo(width, height).LineTo(0, height).Close().Build(),
		},
	};

	private static LayoutContext ContextWithHeight(double height) =>
		new LayoutContext(new BoundingBox(0, 0, 100, height));
}
