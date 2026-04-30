using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Layout;

// Phase 7: tabular layout. Wraps Grid with row/column borders, an optional header row, and
// cell padding so callers don't repeat themselves. Each row of `Rows` is one row of cells;
// each cell is a string (rendered as a TextFlow with optional wrapping) or any DrawElement.
//
// Header row (when HeaderText/HeaderCells are supplied) is row 0; data rows follow. Row
// heights are auto-sized to content unless RowHeight is set; columns default to a single
// `Star(1)` per column unless explicit widths are passed via ColumnWidths.
public sealed class TableCell
{
	// One of the two will be set. When Element != null, it overrides Text/Style.
	public string Text { get; init; }
	public TextStyle Style { get; init; }
	public DrawElement Element { get; init; }
	public int ColumnSpan { get; init; } = 1;
}

public sealed class Table : LayoutElement
{
	public IReadOnlyList<TableCell> Header { get; init; }
	public IReadOnlyList<IReadOnlyList<TableCell>> Rows { get; init; } = Array.Empty<IReadOnlyList<TableCell>>();

	public IReadOnlyList<GridLength> ColumnWidths { get; init; }
	public double? RowHeight { get; init; }
	public Margins CellPadding { get; init; } = new Margins(1.5, 2.5, 1.5, 2.5);

	public Stroke Border { get; init; } = new Stroke { Width = 0.25 };
	public Fill HeaderBackground { get; init; }
	public TextStyle DefaultCellStyle { get; init; } = new TextStyle();

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		var columnCount = InferColumnCount();
		if (columnCount == 0)
			return new GroupElement { Id = Id, CssClass = CssClass, Metadata = Metadata };

		var columnWidths = ResolveColumnWidths(columnCount);

		var gridCells = new List<GridCell>();
		var rowIndex = 0;

		if (Header != null && Header.Count > 0)
		{
			AddRow(gridCells, Header, rowIndex, isHeader: true, columnCount: columnCount, columnWidths: columnWidths);
			rowIndex++;
		}

		foreach (var row in Rows)
		{
			AddRow(gridCells, row, rowIndex, isHeader: false, columnCount: columnCount, columnWidths: columnWidths);
			rowIndex++;
		}

		var rowCount = rowIndex;
		var rowTracks = new GridLength[rowCount];
		for (var i = 0; i < rowCount; i++)
			rowTracks[i] = RowHeight.HasValue ? GridLength.Absolute(RowHeight.Value) : GridLength.Auto;

		var grid = new Grid
		{
			Columns = columnWidths,
			Rows = rowTracks,
			Cells = gridCells,
			Origin = Origin,
		};

		var (gridLayout, totalRect) = grid.ComputeLayout(context);

		var children = new List<DrawElement>();

		// Header background (under content). Drawn before the grid lays out its cells so the
		// fill sits behind the text.
		if (Header != null && Header.Count > 0 && HeaderBackground != null)
		{
			var headerCell = grid.ComputeCellRect(gridLayout, new GridCell { Row = 0, Column = 0, ColumnSpan = columnCount }, totalRect.Height);
			var rect = new Path.Builder()
				.MoveTo(Origin.X + headerCell.MinX, Origin.Y + headerCell.MinY)
				.LineTo(Origin.X + headerCell.MaxX, Origin.Y + headerCell.MinY)
				.LineTo(Origin.X + headerCell.MaxX, Origin.Y + headerCell.MaxY)
				.LineTo(Origin.X + headerCell.MinX, Origin.Y + headerCell.MaxY)
				.Close()
				.Build();
			children.Add(new PathElement { Path = rect, Fill = HeaderBackground });
		}

		// Cell content via the grid.
		var resolvedGrid = grid.Resolve(context);
		children.Add(resolvedGrid);

		// Border lines: outer rect + every internal grid line. We emit them as a single
		// PathElement so the renderer treats the whole frame as one stroked path.
		if (Border != null)
		{
			var borderPath = BuildBorderPath(gridLayout, totalRect);
			children.Add(new PathElement { Path = borderPath, Stroke = Border });
		}

		// Pin outer bounds to the resolved track totals — keeps the natural Table size free
		// of border-stroke inflation, so a 100mm-wide table reports as 100mm wide regardless
		// of border width. The renderer still uses the path's stroke-inflated bounds for
		// viewBox padding, so the visible stroke isn't clipped.
		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(
				Origin.X, Origin.Y,
				Origin.X + totalRect.Width, Origin.Y + totalRect.Height),
		};
	}

	public override BoundingBox ComputeBounds()
	{
		// Resolve in an unconstrained context to get the natural size.
		var resolved = Resolve(new LayoutContext(BoundingBox.Empty));
		return resolved.ComputeBounds();
	}

	private int InferColumnCount()
	{
		var count = 0;
		if (Header != null) count = Math.Max(count, SumColumnSpans(Header));
		foreach (var row in Rows) count = Math.Max(count, SumColumnSpans(row));
		if (ColumnWidths != null && ColumnWidths.Count > count) count = ColumnWidths.Count;
		return count;
	}

	private static int SumColumnSpans(IReadOnlyList<TableCell> row)
	{
		var n = 0;
		if (row == null) return 0;
		foreach (var c in row) n += Math.Max(1, c?.ColumnSpan ?? 1);
		return n;
	}

	private IReadOnlyList<GridLength> ResolveColumnWidths(int columnCount)
	{
		if (ColumnWidths != null && ColumnWidths.Count == columnCount) return ColumnWidths;
		var defaults = new GridLength[columnCount];
		for (var i = 0; i < columnCount; i++) defaults[i] = GridLength.Star(1);
		return defaults;
	}

	private void AddRow(List<GridCell> grid, IReadOnlyList<TableCell> row, int rowIndex, bool isHeader,
		int columnCount, IReadOnlyList<GridLength> columnWidths)
	{
		var col = 0;
		foreach (var cell in row)
		{
			if (cell == null) { col++; continue; }
			var span = Math.Max(1, cell.ColumnSpan);
			if (col + span > columnCount) span = columnCount - col;

			var content = ResolveCellContent(cell, isHeader, col, span, columnWidths);
			grid.Add(new GridCell
			{
				Row = rowIndex,
				Column = col,
				ColumnSpan = span,
				Content = content,
			});
			col += span;
		}
	}

	private DrawElement ResolveCellContent(TableCell cell, bool isHeader, int colStart, int span,
		IReadOnlyList<GridLength> columnWidths)
	{
		if (cell.Element != null) return PadCellElement(cell.Element);

		var style = cell.Style ?? DefaultCellStyle ?? new TextStyle();
		if (isHeader && cell.Style == null && DefaultCellStyle != null)
		{
			style = new TextStyle
			{
				FontFamily = style.FontFamily,
				FontSize = style.FontSize,
				Weight = FontWeight.Bold,
				Style = style.Style,
				Decoration = style.Decoration,
				Color = style.Color,
				HorizontalAnchor = style.HorizontalAnchor,
				VerticalAnchor = style.VerticalAnchor,
				LineHeight = style.LineHeight,
				LetterSpacing = style.LetterSpacing,
			};
		}

		// Compute the available text width = sum of spanned column widths minus padding.
		// Only Absolute columns yield a known width here; for Auto/Star we leave Width=0 so
		// TextFlow doesn't wrap (the cell will size to the longest line).
		var width = ComputeAbsoluteTextWidth(columnWidths, colStart, span);

		var flow = new TextFlow
		{
			Text = cell.Text ?? string.Empty,
			Width = width,
			Style = style,
		};

		return PadCellElement(flow);
	}

	private double ComputeAbsoluteTextWidth(IReadOnlyList<GridLength> columnWidths, int colStart, int span)
	{
		var width = 0.0;
		for (var i = colStart; i < colStart + span; i++)
		{
			if (columnWidths[i].Type != GridLength.Kind.Absolute) return 0;
			width += columnWidths[i].Value;
		}
		return Math.Max(0, width - CellPadding.Left - CellPadding.Right);
	}

	private DrawElement PadCellElement(DrawElement child)
	{
		if (CellPadding.Equals(Margins.Zero)) return child;
		return new Frame
		{
			Child = child,
			Padding = CellPadding,
		};
	}

	// Border path: outer rect + horizontal lines between rows + vertical lines between
	// columns. Each line is a separate MoveTo/LineTo so the stroker doesn't draw a single
	// open polygon.
	private Path BuildBorderPath(Grid.TrackLayout layout, BoundingBox totalRect)
	{
		var b = new Path.Builder();
		var x0 = Origin.X;
		var y0 = Origin.Y;
		var x1 = Origin.X + totalRect.Width;
		var y1 = Origin.Y + totalRect.Height;

		// Outer rectangle.
		b.MoveTo(x0, y0).LineTo(x1, y0).LineTo(x1, y1).LineTo(x0, y1).Close();

		// Horizontal lines between rows. Top of grid = y1; row 0 top = y1; we want a line
		// below row 0, below row 1, ..., above the last row.
		var cursorY = y1;
		for (var r = 0; r < layout.RowHeights.Length - 1; r++)
		{
			cursorY -= layout.RowHeights[r];
			b.MoveTo(x0, cursorY).LineTo(x1, cursorY);
		}

		// Vertical lines between columns.
		var cursorX = x0;
		for (var c = 0; c < layout.ColWidths.Length - 1; c++)
		{
			cursorX += layout.ColWidths[c];
			b.MoveTo(cursorX, y0).LineTo(cursorX, y1);
		}

		return b.Build();
	}
}
