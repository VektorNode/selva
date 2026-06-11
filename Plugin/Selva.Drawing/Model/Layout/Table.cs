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

// Which border lines to draw. Outer = the four edges only; HorizontalOnly = no verticals;
// HeaderAndOuter = outer rect + the rule under the header (clean BOM look); All = full grid.
public enum TableBorderStyle { All, HorizontalOnly, HeaderAndOuter, Outer, None }

public sealed class Table : LayoutElement
{
	public IReadOnlyList<TableCell> Header { get; init; }
	public IReadOnlyList<IReadOnlyList<TableCell>> Rows { get; init; } = Array.Empty<IReadOnlyList<TableCell>>();

	public IReadOnlyList<GridLength> ColumnWidths { get; init; }
	// Per-column horizontal text anchor. Applied to text cells whose own Style doesn't
	// override HorizontalAnchor. Null or short list → cells fall back to the resolved style's
	// own anchor (typically left). Longer than column count → extra entries are ignored.
	public IReadOnlyList<TextAnchor> ColumnAlignments { get; init; }
	public double? RowHeight { get; init; }
	public Margins CellPadding { get; init; } = new Margins(1.5, 2.5, 1.5, 2.5);

	public Stroke Border { get; init; } = new Stroke { Width = 0.25 };
	public TableBorderStyle BorderStyle { get; init; } = TableBorderStyle.All;
	public Fill HeaderBackground { get; init; }
	// Per-row body fills, cycled. Body row k uses RowStripeFills[(StripeOffset + k) % Count].
	// A null entry in the list = no fill for that slot (so [null, gray] = unstriped/gray
	// alternation). Null or empty list = no row fills at all.
	public IReadOnlyList<Fill> RowStripeFills { get; init; }

	// Stripe-cycle phase. Carried into the overflow clone when the table splits across pages
	// so alternating stripes continue seamlessly instead of restarting at slot 0.
	public int StripeOffset { get; init; }
	public TextStyle DefaultCellStyle { get; init; } = new TextStyle();
	// Explicit header text style. When null, header cells inherit DefaultCellStyle with
	// Weight bumped to Bold (see ResolveCellContent).
	public TextStyle HeaderStyle { get; init; }

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
		var hasHeader = Header != null && Header.Count > 0;
		if (hasHeader && HeaderBackground != null)
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

		// Row fills. Body row k cycles through RowStripeFills (k % Count). Null entries skip
		// the fill for that slot. Drawn under cell content for the same reason as the header
		// background.
		if (RowStripeFills != null && RowStripeFills.Count > 0 && Rows != null && Rows.Count > 0)
		{
			var dataStart = hasHeader ? 1 : 0;
			for (var k = 0; k < Rows.Count; k++)
			{
				var fill = RowStripeFills[(StripeOffset + k) % RowStripeFills.Count];
				if (fill == null) continue;
				var stripeCell = grid.ComputeCellRect(gridLayout,
					new GridCell { Row = dataStart + k, Column = 0, ColumnSpan = columnCount },
					totalRect.Height);
				var rect = new Path.Builder()
					.MoveTo(Origin.X + stripeCell.MinX, Origin.Y + stripeCell.MinY)
					.LineTo(Origin.X + stripeCell.MaxX, Origin.Y + stripeCell.MinY)
					.LineTo(Origin.X + stripeCell.MaxX, Origin.Y + stripeCell.MaxY)
					.LineTo(Origin.X + stripeCell.MinX, Origin.Y + stripeCell.MaxY)
					.Close()
					.Build();
				children.Add(new PathElement { Path = rect, Fill = fill });
			}
		}

		// Cell content via the grid.
		var resolvedGrid = grid.Resolve(context);
		children.Add(resolvedGrid);

		// Border lines: outer rect + internal rules per BorderStyle. We emit them as a single
		// PathElement so the renderer treats the whole frame as one stroked path.
		if (Border != null && BorderStyle != TableBorderStyle.None)
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

	// Pagination: tables split between data rows. The header row repeats on every page so a
	// BOM-style table still reads as a table after a break. Tables without a header just
	// split between rows.
	//
	// Edge cases:
	//   - Header alone is taller than availableHeight → NothingFits, caller defers/force-places.
	//   - Header fits but no data row fits → NothingFits, same handling. Avoids emitting a page
	//     of pure chrome (header + zero rows) which would not make forward progress.
	//   - No data rows at all → fall back to atomic resolve (a header-only table either fits or
	//     doesn't).
	public override SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		if (Rows == null || Rows.Count == 0)
			return base.TrySplit(availableHeight, context);

		var (headerHeight, dataRowHeights) = MeasureRowHeights(context);
		const double tol = 1e-6;

		var hasHeader = Header != null && Header.Count > 0;
		if (hasHeader && headerHeight > availableHeight + tol)
			return SplitResult.NothingFits(this);

		var availableForData = availableHeight - headerHeight;
		var fitsRowCount = 0;
		var consumed = 0.0;
		for (var i = 0; i < dataRowHeights.Length; i++)
		{
			if (consumed + dataRowHeights[i] <= availableForData + tol)
			{
				consumed += dataRowHeights[i];
				fitsRowCount++;
			}
			else break;
		}

		if (fitsRowCount == dataRowHeights.Length)
			return base.TrySplit(availableHeight, context);

		if (fitsRowCount == 0)
			return SplitResult.NothingFits(this);

		return SplitAfterRow(fitsRowCount, headerHeight + consumed, context);
	}

	// Nothing fits on a fresh page (header + first row taller than the budget): force out
	// the first row anyway so pagination keeps making progress instead of dumping the whole
	// remaining table onto one page.
	public override SplitResult ForcePlace(double availableHeight, LayoutContext context)
	{
		if (Rows == null || Rows.Count <= 1)
			return base.ForcePlace(availableHeight, context);
		var (headerHeight, dataRowHeights) = MeasureRowHeights(context);
		return SplitAfterRow(1, headerHeight + dataRowHeights[0], context);
	}

	private SplitResult SplitAfterRow(int fitsRowCount, double fallbackHeight, LayoutContext context)
	{
		var fitsRows = new List<IReadOnlyList<TableCell>>(fitsRowCount);
		for (var i = 0; i < fitsRowCount; i++) fitsRows.Add(Rows[i]);
		var overflowRows = new List<IReadOnlyList<TableCell>>(Rows.Count - fitsRowCount);
		for (var i = fitsRowCount; i < Rows.Count; i++) overflowRows.Add(Rows[i]);

		var stripeCount = RowStripeFills?.Count ?? 0;
		var fitsTable = CloneWithRows(fitsRows, Origin, StripeOffset);
		var overflowTable = CloneWithRows(overflowRows, Point2D.Zero,
			stripeCount > 0 ? (StripeOffset + fitsRowCount) % stripeCount : 0);

		var fitsResolved = fitsTable.Resolve(context);
		var fitsBounds = fitsResolved?.ComputeBounds() ?? BoundingBox.Empty;
		var fitsHeight = fitsBounds.IsEmpty ? fallbackHeight : fitsBounds.Height;
		return SplitResult.Partial(fitsResolved, overflowTable, fitsHeight);
	}

	private Table CloneWithRows(IReadOnlyList<IReadOnlyList<TableCell>> rows, Point2D origin, int stripeOffset)
	{
		return new Table
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Header = Header,
			Rows = rows,
			ColumnWidths = ColumnWidths,
			ColumnAlignments = ColumnAlignments,
			RowHeight = RowHeight,
			CellPadding = CellPadding,
			Border = Border,
			BorderStyle = BorderStyle,
			HeaderBackground = HeaderBackground,
			RowStripeFills = RowStripeFills,
			StripeOffset = stripeOffset,
			DefaultCellStyle = DefaultCellStyle,
			HeaderStyle = HeaderStyle,
			Origin = origin,
		};
	}

	// Per-row heights used by TrySplit. We build the same Grid Resolve uses, run its full
	// two-pass layout against the parent context (so Star columns get their real widths and
	// cells re-measure with that width), and read row heights straight off the resulting
	// TrackLayout. This keeps TrySplit's "rows that fit" arithmetic consistent with how the
	// fits half is actually rendered — a TextFlow that wraps to N lines in render also
	// reports N-line height here, so the trailing rows don't get pushed past the page edge.
	private (double headerHeight, double[] dataRowHeights) MeasureRowHeights(LayoutContext context)
	{
		var columnCount = InferColumnCount();
		if (columnCount == 0) return (0, Array.Empty<double>());

		if (RowHeight.HasValue)
		{
			var hasHdr = Header != null && Header.Count > 0;
			var rowHsFixed = new double[Rows.Count];
			for (var i = 0; i < rowHsFixed.Length; i++) rowHsFixed[i] = RowHeight.Value;
			return (hasHdr ? RowHeight.Value : 0, rowHsFixed);
		}

		var columnWidths = ResolveColumnWidths(columnCount);
		var gridCells = new List<GridCell>();
		var rowIndex = 0;
		var hasHeader = Header != null && Header.Count > 0;
		if (hasHeader)
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
		for (var i = 0; i < rowCount; i++) rowTracks[i] = GridLength.Auto;

		var grid = new Grid
		{
			Columns = columnWidths,
			Rows = rowTracks,
			Cells = gridCells,
			Origin = Origin,
		};
		var (layout, _) = grid.ComputeLayout(context);

		var headerH = hasHeader ? layout.RowHeights[0] : 0;
		var dataStart = hasHeader ? 1 : 0;
		var rowHs = new double[Rows.Count];
		for (var i = 0; i < Rows.Count; i++) rowHs[i] = layout.RowHeights[dataStart + i];
		return (headerH, rowHs);
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

			var content = ResolveCellContent(cell, isHeader, col);
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

	private DrawElement ResolveCellContent(TableCell cell, bool isHeader, int columnIndex)
	{
		if (cell.Element != null) return PadCellElement(cell.Element);

		var style = cell.Style ?? DefaultCellStyle ?? new TextStyle();
		if (isHeader && cell.Style == null)
		{
			if (HeaderStyle != null)
			{
				style = HeaderStyle;
			}
			else if (DefaultCellStyle != null)
			{
				style = CloneWithWeight(style, FontWeight.Bold);
			}
		}

		// Per-column alignment overrides the resolved style's HorizontalAnchor — but only
		// when the cell didn't bring its own Style. A caller that sets cell.Style is making
		// an explicit choice and shouldn't be silently overridden by the column default.
		if (cell.Style == null
			&& ColumnAlignments != null
			&& columnIndex >= 0 && columnIndex < ColumnAlignments.Count
			&& style.HorizontalAnchor != ColumnAlignments[columnIndex])
		{
			style = CloneWithAnchor(style, ColumnAlignments[columnIndex]);
		}

		// Width is left null: the TextFlow inherits its wrap width from the surrounding
		// Frame (cell padding) which itself inherits from the Grid cell rect. This works
		// for Absolute, Auto, and Star columns alike — no per-column-type special-casing.
		var flow = new TextFlow
		{
			Text = cell.Text ?? string.Empty,
			Style = style,
		};

		return PadCellElement(flow);
	}

	private static TextStyle CloneWithWeight(TextStyle s, FontWeight w) => new TextStyle
	{
		FontFamily = s.FontFamily,
		FontSize = s.FontSize,
		Weight = w,
		Style = s.Style,
		Decoration = s.Decoration,
		Color = s.Color,
		HorizontalAnchor = s.HorizontalAnchor,
		VerticalAnchor = s.VerticalAnchor,
		LineHeight = s.LineHeight,
		LetterSpacing = s.LetterSpacing,
	};

	private static TextStyle CloneWithAnchor(TextStyle s, TextAnchor a) => new TextStyle
	{
		FontFamily = s.FontFamily,
		FontSize = s.FontSize,
		Weight = s.Weight,
		Style = s.Style,
		Decoration = s.Decoration,
		Color = s.Color,
		HorizontalAnchor = a,
		VerticalAnchor = s.VerticalAnchor,
		LineHeight = s.LineHeight,
		LetterSpacing = s.LetterSpacing,
	};

	private DrawElement PadCellElement(DrawElement child)
	{
		if (CellPadding.Equals(Margins.Zero)) return child;
		return new Frame
		{
			Child = child,
			Padding = CellPadding,
		};
	}

	// Border path: outer rect + optional internal rules per BorderStyle. Each line is a
	// separate MoveTo/LineTo so the stroker doesn't draw a single open polygon.
	private Path BuildBorderPath(Grid.TrackLayout layout, BoundingBox totalRect)
	{
		var b = new Path.Builder();
		var x0 = Origin.X;
		var y0 = Origin.Y;
		var x1 = Origin.X + totalRect.Width;
		var y1 = Origin.Y + totalRect.Height;

		var style = BorderStyle;
		var drawOuter = style != TableBorderStyle.None;
		var drawHorizontals = style == TableBorderStyle.All || style == TableBorderStyle.HorizontalOnly;
		var drawVerticals = style == TableBorderStyle.All;
		var drawHeaderRule = style == TableBorderStyle.HeaderAndOuter && Header != null && Header.Count > 0;

		if (drawOuter)
			b.MoveTo(x0, y0).LineTo(x1, y0).LineTo(x1, y1).LineTo(x0, y1).Close();

		// Horizontal lines between rows. Top of grid = y1; row 0 top = y1; we want a line
		// below row 0, below row 1, ..., above the last row.
		if (drawHorizontals)
		{
			var cursorY = y1;
			for (var r = 0; r < layout.RowHeights.Length - 1; r++)
			{
				cursorY -= layout.RowHeights[r];
				b.MoveTo(x0, cursorY).LineTo(x1, cursorY);
			}
		}
		else if (drawHeaderRule)
		{
			// Just the rule under the header row (row 0 in track order = top track).
			var ruleY = y1 - layout.RowHeights[0];
			b.MoveTo(x0, ruleY).LineTo(x1, ruleY);
		}

		if (drawVerticals)
		{
			var cursorX = x0;
			for (var c = 0; c < layout.ColWidths.Length - 1; c++)
			{
				cursorX += layout.ColWidths[c];
				b.MoveTo(cursorX, y0).LineTo(cursorX, y1);
			}
		}

		return b.Build();
	}
}
