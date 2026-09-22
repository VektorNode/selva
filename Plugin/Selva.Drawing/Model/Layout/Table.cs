using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Layout;

// Tabular layout on top of Grid: row/column borders, an optional header row, cell padding.
// Each row of `Rows` is one row of cells; each cell is a string (rendered as a TextFlow) or
// any DrawElement.
//
// Header row (when Header is supplied) is row 0; data rows follow. Row heights auto-size to
// content unless RowHeight is set; columns default to `Star(1)` unless ColumnWidths is set.
public sealed class TableCell
{
	// Element, when set, overrides Text/Style.
	public string Text { get; init; }
	public TextStyle Style { get; init; }
	public DrawElement Element { get; init; }
	public int ColumnSpan { get; init; } = 1;
}

// Outer = the four edges only; HorizontalOnly = no verticals; HeaderAndOuter = outer rect +
// the rule under the header; All = full grid.
public enum TableBorderStyle { All, HorizontalOnly, HeaderAndOuter, Outer, None }

public sealed class Table : LayoutElement
{
	public IReadOnlyList<TableCell> Header { get; init; }
	public IReadOnlyList<IReadOnlyList<TableCell>> Rows { get; init; } = Array.Empty<IReadOnlyList<TableCell>>();

	public IReadOnlyList<GridLength> ColumnWidths { get; init; }
	// Per-column text anchor; only applies to cells that don't set their own Style.HorizontalAnchor.
	public IReadOnlyList<TextAnchor> ColumnAlignments { get; init; }
	public double? RowHeight { get; init; }
	public Margins CellPadding { get; init; } = new Margins(1.5, 2.5, 1.5, 2.5);

	public Stroke Border { get; init; } = new Stroke { Width = LineWeight.Fine };
	public TableBorderStyle BorderStyle { get; init; } = TableBorderStyle.All;
	public Fill HeaderBackground { get; init; }
	// Body row k uses RowStripeFills[(StripeOffset + k) % Count]; a null entry means no fill
	// for that slot (e.g. [null, gray] alternates unstriped/gray).
	public IReadOnlyList<Fill> RowStripeFills { get; init; }

	// Carried into the overflow clone on page split so stripes keep alternating instead of
	// restarting at slot 0.
	public int StripeOffset { get; init; }
	public TextStyle DefaultCellStyle { get; init; } = new TextStyle();
	// When null, header cells inherit DefaultCellStyle with Weight bumped to Bold (ResolveCellContent).
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

		// Header fill drawn before grid content so it sits behind the text.
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

		// Row fills, drawn under cell content same as the header fill above.
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

		var resolvedGrid = grid.Resolve(context);
		children.Add(resolvedGrid);

		// One PathElement for the whole border (outer rect + internal rules per BorderStyle)
		// so the renderer strokes it as a single path.
		if (Border != null && BorderStyle != TableBorderStyle.None)
		{
			var borderPath = BuildBorderPath(gridLayout, totalRect);
			children.Add(new PathElement { Path = borderPath, Stroke = Border });
		}

		// Pin outer bounds to the track totals, not the stroke-inflated border/fill paths, so
		// a 100mm-wide table reports 100mm regardless of border width. The renderer still uses
		// the border path's own inflated bounds for viewBox padding, so the stroke isn't clipped.
		var pinned = new BoundingBox(
			Origin.X, Origin.Y,
			Origin.X + totalRect.Width, Origin.Y + totalRect.Height);

		// RowHeight is an Absolute track, and content taller than its row draws past it rather
		// than clipping, so union in the grid's own ink to make the reported bounds cover any
		// overhang (else downstream containers lay out around a box the table already overran).
		var cellInk = resolvedGrid?.ComputeBounds() ?? BoundingBox.Empty;
		if (!cellInk.IsEmpty) pinned = pinned.Union(cellInk);

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = pinned,
		};
	}

	public override BoundingBox ComputeBounds()
	{
		// Resolve in an unconstrained context to get the natural size.
		var resolved = Resolve(new LayoutContext(BoundingBox.Empty));
		return resolved.ComputeBounds();
	}

	// Tables split between data rows; the header repeats on every page. If the header alone
	// doesn't fit, or fits but no data row does, NothingFits (never emit a page of pure chrome).
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

	// Header + first row taller than the budget: force the first row out anyway so pagination
	// keeps making progress instead of dumping the rest of the table onto one page.
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

		// Pin the whole table's resolved column widths onto both fragments: otherwise each
		// fragment re-derives Auto widths from its own row subset, and the column edges jump
		// at the page break whenever the widest cell lands in the other half.
		var pinnedWidths = ResolvePinnedColumnWidths(context);

		var stripeCount = RowStripeFills?.Count ?? 0;
		var fitsTable = CloneWithRows(fitsRows, Origin, StripeOffset, pinnedWidths);
		var overflowTable = CloneWithRows(overflowRows, Point2D.Zero,
			stripeCount > 0 ? (StripeOffset + fitsRowCount) % stripeCount : 0, pinnedWidths);

		var fitsResolved = fitsTable.Resolve(context);
		var fitsBounds = fitsResolved?.ComputeBounds() ?? BoundingBox.Empty;
		var fitsHeight = fitsBounds.IsEmpty ? fallbackHeight : fitsBounds.Height;
		return SplitResult.Partial(fitsResolved, overflowTable, fitsHeight);
	}

	// Resolves the table's column widths under this context down to absolute tracks. Skipped
	// when every declared width is already Absolute, since those can't drift between fragments.
	private IReadOnlyList<GridLength> ResolvePinnedColumnWidths(LayoutContext context)
	{
		var columnCount = InferColumnCount();
		if (columnCount == 0) return ColumnWidths;

		var declared = ResolveColumnWidths(columnCount);
		var allAbsolute = true;
		foreach (var w in declared)
		{
			if (w.Type != GridLength.Kind.Absolute) { allAbsolute = false; break; }
		}
		if (allAbsolute) return declared;

		var gridCells = new List<GridCell>();
		var rowIndex = 0;
		if (Header != null && Header.Count > 0)
		{
			AddRow(gridCells, Header, rowIndex, isHeader: true, columnCount: columnCount, columnWidths: declared);
			rowIndex++;
		}
		foreach (var row in Rows)
		{
			AddRow(gridCells, row, rowIndex, isHeader: false, columnCount: columnCount, columnWidths: declared);
			rowIndex++;
		}
		var rowTracks = new GridLength[rowIndex];
		for (var i = 0; i < rowTracks.Length; i++)
			rowTracks[i] = RowHeight.HasValue ? GridLength.Absolute(RowHeight.Value) : GridLength.Auto;

		var grid = new Grid
		{
			Columns = declared,
			Rows = rowTracks,
			Cells = gridCells,
			Origin = Origin,
		};
		var (layout, _) = grid.ComputeLayout(context);

		var pinned = new GridLength[layout.ColWidths.Length];
		for (var i = 0; i < pinned.Length; i++)
			pinned[i] = GridLength.Absolute(layout.ColWidths[i]);
		return pinned;
	}

	private Table CloneWithRows(IReadOnlyList<IReadOnlyList<TableCell>> rows, Point2D origin, int stripeOffset,
		IReadOnlyList<GridLength> columnWidths)
	{
		return new Table
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Header = Header,
			Rows = rows,
			ColumnWidths = columnWidths,
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

	// Builds the same Grid Resolve would and reads row heights off its TrackLayout, so
	// TrySplit's "rows that fit" arithmetic matches what actually renders (a TextFlow that
	// wraps to N lines here also wraps to N lines in Resolve).
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

	// Declared widths are honoured as far as they go; remaining columns fall back to Star.
	// A count mismatch used to discard the whole list (two widths for three columns meant all
	// three came out Star), which reads as "ColumnWidths does nothing" rather than "one width missing".
	private IReadOnlyList<GridLength> ResolveColumnWidths(int columnCount)
	{
		if (ColumnWidths != null && ColumnWidths.Count == columnCount) return ColumnWidths;

		var widths = new GridLength[columnCount];
		var declared = ColumnWidths?.Count ?? 0;
		for (var i = 0; i < columnCount; i++)
			widths[i] = i < declared ? ColumnWidths[i] : GridLength.Star(1);
		return widths;
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

		// Column alignment overrides HorizontalAnchor only when the cell has no Style of its own:
		// an explicit cell.Style shouldn't be silently overridden by the column default.
		if (cell.Style == null
			&& ColumnAlignments != null
			&& columnIndex >= 0 && columnIndex < ColumnAlignments.Count
			&& style.HorizontalAnchor != ColumnAlignments[columnIndex])
		{
			style = CloneWithAnchor(style, ColumnAlignments[columnIndex]);
		}

		// Width left null: TextFlow inherits its wrap width from the Frame (cell padding),
		// which inherits from the Grid cell rect, working for Absolute, Auto, and Star alike.
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

	// Each line is a separate MoveTo/LineTo so the stroker doesn't draw one open polygon.
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

		// Lines below row 0, below row 1, ..., above the last row (grid top = y1).
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
