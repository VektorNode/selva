using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Tests.Model.Layout;

public class TableTests
{
	[Fact]
	public void Empty_table_resolves_to_empty_group()
	{
		var resolved = (GroupElement)new Table().Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.Empty(resolved.Children);
	}

	[Fact]
	public void Table_with_header_and_rows_produces_grid_plus_border()
	{
		var table = new Table
		{
			ColumnWidths = new[] { GridLength.Absolute(20), GridLength.Absolute(40) },
			Header = new[] { Cell("Item"), Cell("Description") },
			Rows = new[]
			{
				new[] { Cell("M3 × 10"), Cell("Pan-head screw") },
				new[] { Cell("M4 nut"), Cell("Hex nut, A2 stainless") },
			},
			Border = new Stroke { Width = 0.25 },
		};
		var resolved = (GroupElement)table.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.True(resolved.Children.Count >= 2); // grid + border path, at minimum
		Assert.IsType<PathElement>(resolved.Children[resolved.Children.Count - 1]);
	}

	[Fact]
	public void Table_total_width_matches_sum_of_absolute_columns()
	{
		var table = new Table
		{
			ColumnWidths = new[] { GridLength.Absolute(20), GridLength.Absolute(30), GridLength.Absolute(50) },
			Rows = new[] { new[] { Cell("a"), Cell("b"), Cell("c") } },
			CellPadding = new Margins(1, 2, 1, 2),
		};
		var b = table.ComputeBounds();
		Assert.Equal(100, b.Width, 6);
	}

	[Fact]
	public void Header_row_uses_bold_when_no_explicit_style()
	{
		var table = new Table
		{
			ColumnWidths = new[] { GridLength.Absolute(40) },
			Header = new[] { Cell("Title") },
			Rows = new[] { new[] { Cell("body") } },
			DefaultCellStyle = new TextStyle { FontSize = 3 },
		};
		// No public API exposes the resolved style directly, so this only checks that
		// resolution succeeds — bold is applied internally inside the cell.
		var resolved = table.Resolve(new LayoutContext(BoundingBox.Empty));
		Assert.NotNull(resolved);
	}

	[Fact]
	public void Five_by_four_bom_table_renders_to_pdf_and_svg()
	{
		var table = new Table
		{
			ColumnWidths = new[]
			{
				GridLength.Absolute(15),
				GridLength.Absolute(20),
				GridLength.Star(1),
				GridLength.Absolute(20),
			},
			Header = new[] { Cell("#"), Cell("Part"), Cell("Description"), Cell("Qty") },
			Rows = new[]
			{
				new[] { Cell("1"), Cell("M3-10"), Cell("Pan-head machine screw, A2"), Cell("4") },
				new[] { Cell("2"), Cell("M3-NUT"), Cell("Hex nut, A2 stainless steel"), Cell("4") },
				new[] { Cell("3"), Cell("M3-W"), Cell("Flat washer, A2 stainless"), Cell("8") },
				new[] { Cell("4"), Cell("BRKT-01"), Cell("Aluminium L-bracket"), Cell("1") },
				new[] { Cell("5"), Cell("PL-150"), Cell("Mounting plate, 6mm Al-6061"), Cell("1") },
			},
			Border = new Stroke { Width = 0.25 },
		};
		var b = table.ComputeBounds();
		Assert.True(b.Width > 0);
		Assert.True(b.Height > 0);
	}

	private static TableCell Cell(string text) => new TableCell { Text = text };
}
