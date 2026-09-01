using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// A CSS-grid-style track. Each track is one of:
//   Absolute(mm): fixed width/height
//   Auto: sized to the largest natural size of its content
//   Star(weight): distributes remaining space proportionally (like CSS `1fr`)
public readonly struct GridLength
{
	public enum Kind { Absolute, Auto, Star }

	public Kind Type { get; }
	public double Value { get; }

	private GridLength(Kind kind, double value)
	{
		Type = kind;
		Value = value;
	}

	public static GridLength Absolute(double mm) => new GridLength(Kind.Absolute, mm);
	public static readonly GridLength Auto = new GridLength(Kind.Auto, 0);
	public static GridLength Star(double weight = 1.0) => new GridLength(Kind.Star, weight <= 0 ? 1.0 : weight);
}

// One cell placed at (Row, Column). RowSpan/ColumnSpan let a cell occupy multiple tracks.
public sealed class GridCell
{
	public int Row { get; init; }
	public int Column { get; init; }
	public int RowSpan { get; init; } = 1;
	public int ColumnSpan { get; init; } = 1;
	public DrawElement Content { get; init; }
}

// Reported by Grid.ComputeOverflows when a cell's natural content exceeds its allocated
// track space. Components surface these as runtime warnings: actionable feedback at
// graph-eval time rather than waiting for the final render to look wrong.
public sealed class GridOverflow
{
	public int CellIndex { get; init; }
	public int Row { get; init; }
	public int Column { get; init; }
	public double ContentWidth { get; init; }
	public double ContentHeight { get; init; }
	public double CellWidth { get; init; }
	public double CellHeight { get; init; }
	public bool OverflowsWidth => ContentWidth > CellWidth + 1e-6;
	public bool OverflowsHeight => ContentHeight > CellHeight + 1e-6;
}

// A flex grid: resolves rows × columns and places each cell at the intersection. Natural size
// honours absolute/auto tracks; star tracks expand to fill `LayoutContext.AvailableWidth`/
// `AvailableHeight` when the context is finite, otherwise fall back to the largest auto-sized
// cell on that track.
//
// Anchor: bottom-left of the grid sits at Origin in world coords. Y-up: row 0 is the TOP
// row visually (matching how spreadsheets and DOM tables read).
public sealed class Grid : LayoutElement
{
	public IReadOnlyList<GridLength> Columns { get; init; } = Array.Empty<GridLength>();
	public IReadOnlyList<GridLength> Rows { get; init; } = Array.Empty<GridLength>();
	public IReadOnlyList<GridCell> Cells { get; init; } = Array.Empty<GridCell>();
	public double ColumnSpacing { get; init; } = 0.0;
	public double RowSpacing { get; init; } = 0.0;
	public Point2D Origin { get; init; } = Point2D.Zero;

	// Result of resolving track sizes; surfaced so Table (a thin wrapper around Grid) can
	// reuse the same arithmetic for its border lines.
	internal sealed class TrackLayout
	{
		public double[] ColWidths;
		public double[] RowHeights;
		public DrawElement[] ResolvedCells;       // parallel to Cells
		public BoundingBox[] CellBounds;          // parallel to Cells
	}

	public override DrawElement Resolve(LayoutContext context)
	{
		var (layout, total) = ComputeLayout(context);
		var children = new List<DrawElement>(layout.ResolvedCells.Length);
		PlaceCells(layout, total.Width, children);

		// Dotted box per track intersection, visible in the Rhino viewport wherever the grid
		// is nested. Tagged PreviewOnly so SVG/PDF export skips them.
		AppendCellGuides(layout, children);

		// Stack/Frame/Table consumers measure resolved-child bounds and need the grid's full
		// track extent, not just the union of cell content (which can be smaller than its track).
		var pinned = new BoundingBox(
			Origin.X, Origin.Y,
			Origin.X + total.Width, Origin.Y + total.Height);

		// The track total is a floor, not a ceiling: content taller/wider than its cell is drawn,
		// not clipped (deliberately, for Absolute tracks where sizing is the user's choice), but
		// the reported box must still cover what was drawn, or a Table with RowHeight=5 reports
		// h=5 while wrapped text hangs below its own bottom edge, and every downstream container
		// lays out around a box that's already overrun.
		//
		// Uses placed-cell bounds, not the pre-placement CellBounds, which are in the grid's own
		// coordinate space.
		foreach (var child in children)
		{
			if (child is GroupElement guide && guide.PreviewOnly) continue;
			var b = child?.ComputeBounds() ?? BoundingBox.Empty;
			if (!b.IsEmpty) pinned = pinned.Union(b);
		}

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = pinned,
		};
	}

	private void AppendCellGuides(TrackLayout layout, List<DrawElement> children)
	{
		var totalHeight = SumWithSpacing(layout.RowHeights, RowSpacing);
		for (var r = 0; r < layout.RowHeights.Length; r++)
			for (var c = 0; c < layout.ColWidths.Length; c++)
			{
				var local = ComputeCellRect(layout, new GridCell { Row = r, Column = c }, totalHeight);
				if (local.Width <= 0 || local.Height <= 0) continue;
				children.Add(new GroupElement
				{
					PreviewOnly = true,
					BoundsOverride = new BoundingBox(
						Origin.X + local.MinX, Origin.Y + local.MinY,
						Origin.X + local.MaxX, Origin.Y + local.MaxY),
				});
			}
	}

	public override BoundingBox ComputeBounds()
	{
		var (_, total) = ComputeLayout(new LayoutContext(BoundingBox.Empty));
		return new BoundingBox(Origin.X, Origin.Y, Origin.X + total.Width, Origin.Y + total.Height);
	}

	// Returns one entry per cell whose resolved content exceeds its allocated cell rect. In
	// standalone evaluation (no parent context), pass `new LayoutContext(BoundingBox.Empty)`:
	// only Absolute-track overflows are detected then, since Auto tracks always grow to fit and
	// Star tracks fall back to natural sizes when available is infinite.
	public IReadOnlyList<GridOverflow> ComputeOverflows(LayoutContext context)
	{
		var (layout, _) = ComputeLayout(context);
		var totalHeight = SumWithSpacing(layout.RowHeights, RowSpacing);
		var result = new List<GridOverflow>();
		for (var i = 0; i < Cells.Count; i++)
		{
			var cell = Cells[i];
			if (cell.Row < 0 || cell.Row >= layout.RowHeights.Length) continue;
			if (cell.Column < 0 || cell.Column >= layout.ColWidths.Length) continue;
			var b = layout.CellBounds[i];
			if (b.IsEmpty) continue;
			var rect = ComputeCellRect(layout, cell, totalHeight);
			var ov = new GridOverflow
			{
				CellIndex = i,
				Row = cell.Row,
				Column = cell.Column,
				ContentWidth = b.Width,
				ContentHeight = b.Height,
				CellWidth = rect.Width,
				CellHeight = rect.Height,
			};
			if (ov.OverflowsWidth || ov.OverflowsHeight) result.Add(ov);
		}
		return result;
	}

	internal (TrackLayout Layout, BoundingBox Total) ComputeLayout(LayoutContext context)
	{
		var colCount = Columns.Count;
		var rowCount = Rows.Count;
		var resolvedCells = new DrawElement[Cells.Count];
		var cellBounds = new BoundingBox[Cells.Count];

		// Pass 1: measure each cell against the grid's own budget so Auto tracks know their
		// natural sizes. The budget is a ceiling, not an assignment: content smaller than a cell
		// still reports its natural size, and Pass 2 re-resolves against the real cell rect once
		// tracks are known.
		//
		// Measuring with an empty context instead would let a self-sizing child (an auto-fit
		// DrawingView) report an unbounded natural size that becomes the Auto track's size,
		// running the grid off the page. Auto tracks grow to fit their content, so an overlarge
		// measurement here is never clamped later.
		var measureContext = MeasureContext(context);
		for (var i = 0; i < Cells.Count; i++)
		{
			var c = Cells[i];
			var resolved = c.Content is LayoutElement nested
				? nested.Resolve(measureContext)
				: c.Content;
			resolvedCells[i] = resolved;
			cellBounds[i] = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		}

		var colWidths = ResolveTrackSizes(Columns, Cells, cellBounds, context.AvailableWidth, ColumnSpacing, isColumn: true);
		var rowHeights = ResolveTrackSizes(Rows, Cells, cellBounds, context.AvailableHeight, RowSpacing, isColumn: false);

		// Pass 2: re-resolve LayoutElement cells against their real cell rect, so e.g. a TextFlow
		// in a Star column wraps to the column's resolved width. Primitives don't depend on
		// context, so they're left alone.
		for (var i = 0; i < Cells.Count; i++)
		{
			var c = Cells[i];
			if (c.Content is not LayoutElement nested) continue;
			var cellWidth = SpanSize(colWidths, c.Column, c.ColumnSpan, ColumnSpacing);
			var cellHeight = SpanSize(rowHeights, c.Row, c.RowSpan, RowSpacing);
			if (cellWidth <= 0 || cellHeight <= 0) continue;
			var cellContext = new LayoutContext(new BoundingBox(0, 0, cellWidth, cellHeight));
			resolvedCells[i] = nested.Resolve(cellContext);
			cellBounds[i] = resolvedCells[i]?.ComputeBounds() ?? BoundingBox.Empty;
		}

		// Pass 3: re-grow Auto rows whose content got taller after Pass 2 wrapped to the real
		// column width. Columns stay locked (width was Pass 2's input, height is the downstream
		// effect); only Auto rows participate, since Absolute/Star rows keep the explicit size
		// the user asked for.
		//
		// KNOWN GAP (unconfirmed): Star rows are sized in ResolveTrackSizes from the Pass-1 Auto
		// heights and are never re-derived after this pass grows them, so a Star row can in
		// principle keep a budget that assumed a shorter Auto neighbour. An audit reported a
		// 190x54 grid pinning h=80.14 (grown Auto 43.56 + stale Star 36.58) with `[Auto,Star,Auto]`
		// driving ink to y=-16.1mm, but two later reproduction attempts, including one with the
		// original probe's parameters, both resolved to exactly 54.000 with minY=0.000: the
		// overflow could not be demonstrated and no fix was applied. The asymmetry is real;
		// whether it can actually overflow is not established. Reproduce before changing this.
		for (var r = 0; r < Rows.Count; r++)
		{
			if (Rows[r].Type != GridLength.Kind.Auto) continue;
			var grown = LargestNaturalSizeOnTrack(Cells, cellBounds, r, isColumn: false);
			if (grown > rowHeights[r]) rowHeights[r] = grown;
		}

		var totalWidth = SumWithSpacing(colWidths, ColumnSpacing);
		var totalHeight = SumWithSpacing(rowHeights, RowSpacing);

		return (new TrackLayout
		{
			ColWidths = colWidths,
			RowHeights = rowHeights,
			ResolvedCells = resolvedCells,
			CellBounds = cellBounds,
		}, new BoundingBox(0, 0, totalWidth, totalHeight));
	}

	// Ceiling for the Pass 1 measurement: no single cell may measure larger than the grid's own
	// budget. Falls back to an empty context when the grid itself is unconstrained, preserving
	// "measure naturally" for auto-fit pages.
	private LayoutContext MeasureContext(LayoutContext context)
	{
		var w = TrackCeiling(context.AvailableWidth, Columns, ColumnSpacing);
		var h = TrackCeiling(context.AvailableHeight, Rows, RowSpacing);
		if (double.IsPositiveInfinity(w) && double.IsPositiveInfinity(h))
			return new LayoutContext(BoundingBox.Empty);
		return new LayoutContext(new BoundingBox(0, 0, w, h));
	}

	// Room available to one track whose size is not yet known: the axis budget, less spacing,
	// less tracks already committed to a size, divided among the tracks that remain unknown.
	// Grid tracks lay out simultaneously (unlike a Stack, where a modest child can pass its
	// surplus along), so each cell must be measured against its own share or the tracks sum
	// past the axis. ResolveTrackSizes redistributes afterwards, so a cell measuring smaller
	// than its share leaves room for Star tracks to absorb.
	//
	// Absolute tracks are subtracted rather than counted in the divisor: they consume that space
	// regardless of measurement, so counting them let an Auto neighbour measure against room
	// that was never available, e.g. [Absolute(150), Auto] produced a 245 mm grid on a 190 mm sheet.
	// Star tracks stay in the divisor since their size is genuinely unknown here.
	//
	// Dividing the whole remainder among each unknown track independently (rather than by
	// share) would let 2 Auto tracks measure 190 mm each and sum to 380 on a 190 mm budget.
	private static double TrackCeiling(double available, IReadOnlyList<GridLength> tracks, double spacing)
	{
		if (double.IsInfinity(available) || available <= 0) return double.PositiveInfinity;

		var count = Math.Max(1, tracks.Count);
		var committed = 0.0;
		var unknown = 0;
		for (var i = 0; i < tracks.Count; i++)
		{
			if (tracks[i].Type == GridLength.Kind.Absolute) committed += tracks[i].Value;
			else unknown++;
		}
		if (unknown == 0) return double.PositiveInfinity;

		var usable = available - spacing * Math.Max(0, count - 1) - committed;
		return usable > 0 ? usable / unknown : double.PositiveInfinity;
	}

	private static double SpanSize(double[] sizes, int start, int span, double spacing)
	{
		var total = 0.0;
		var count = 0;
		for (var i = start; i < start + span && i < sizes.Length; i++)
		{
			total += sizes[i];
			count++;
		}
		if (count > 1) total += spacing * (count - 1);
		return total;
	}

	private double[] ResolveTrackSizes(IReadOnlyList<GridLength> tracks, IReadOnlyList<GridCell> cells,
		BoundingBox[] cellBounds, double available, double spacing, bool isColumn)
	{
		var sizes = new double[tracks.Count];
		var totalStarWeight = 0.0;

		for (var i = 0; i < tracks.Count; i++)
		{
			switch (tracks[i].Type)
			{
				case GridLength.Kind.Absolute:
					sizes[i] = tracks[i].Value;
					break;
				case GridLength.Kind.Auto:
					sizes[i] = LargestNaturalSizeOnTrack(cells, cellBounds, i, isColumn);
					break;
				case GridLength.Kind.Star:
					totalStarWeight += tracks[i].Value;
					break;
			}
		}

		// Star tracks soak up what's left of `available` after fixed/auto; if available is
		// infinite, each falls back to its largest natural cell, same as Auto.
		if (totalStarWeight > 0)
		{
			if (double.IsInfinity(available))
			{
				for (var i = 0; i < tracks.Count; i++)
					if (tracks[i].Type == GridLength.Kind.Star)
						sizes[i] = LargestNaturalSizeOnTrack(cells, cellBounds, i, isColumn);
			}
			else
			{
				var consumed = 0.0;
				var trackCount = tracks.Count;
				for (var i = 0; i < trackCount; i++)
					if (tracks[i].Type != GridLength.Kind.Star) consumed += sizes[i];
				consumed += spacing * Math.Max(0, trackCount - 1);

				var starBudget = Math.Max(0, available - consumed);
				for (var i = 0; i < trackCount; i++)
					if (tracks[i].Type == GridLength.Kind.Star)
						sizes[i] = starBudget * (tracks[i].Value / totalStarWeight);
			}
		}

		return sizes;
	}

	private static double LargestNaturalSizeOnTrack(IReadOnlyList<GridCell> cells, BoundingBox[] bounds,
		int trackIndex, bool isColumn)
	{
		var max = 0.0;
		for (var i = 0; i < cells.Count; i++)
		{
			var c = cells[i];
			var span = isColumn ? c.ColumnSpan : c.RowSpan;
			var start = isColumn ? c.Column : c.Row;
			// Spanning cells contribute their natural size divided evenly across the spanned
			// tracks, matching how most flex grids handle the spanning-auto case.
			if (start <= trackIndex && trackIndex < start + span)
			{
				if (bounds[i].IsEmpty) continue;
				var natural = isColumn ? bounds[i].Width : bounds[i].Height;
				var contribution = span == 1 ? natural : natural / span;
				if (contribution > max) max = contribution;
			}
		}
		return max;
	}

	private static double SumWithSpacing(double[] sizes, double spacing)
	{
		var sum = 0.0;
		for (var i = 0; i < sizes.Length; i++) sum += sizes[i];
		sum += spacing * Math.Max(0, sizes.Length - 1);
		return sum;
	}

	private void PlaceCells(TrackLayout layout, double totalWidth, List<DrawElement> children)
	{
		var totalHeight = SumWithSpacing(layout.RowHeights, RowSpacing);

		for (var i = 0; i < Cells.Count; i++)
		{
			var cell = Cells[i];
			var resolved = layout.ResolvedCells[i];
			if (resolved == null) continue;

			var cellRect = ComputeCellRect(layout, cell, totalHeight);
			var b = layout.CellBounds[i];
			DrawElement positioned;
			if (b.IsEmpty)
			{
				positioned = resolved;
			}
			else
			{
				// Place the child's top-left at the cell rect's top-left corner.
				var tx = Origin.X + cellRect.MinX - b.MinX;
				var ty = Origin.Y + cellRect.MaxY - b.MaxY;
				positioned = (Math.Abs(tx) < 1e-12 && Math.Abs(ty) < 1e-12)
					? resolved
					: new GroupElement
					{
						Transform = Transform.Translate(tx, ty),
						Children = new[] { resolved },
					};
			}
			children.Add(positioned);
		}
	}

	// Compute the cell's rect in grid-local Y-up coords (origin at grid bottom-left).
	internal BoundingBox ComputeCellRect(TrackLayout layout, GridCell cell, double totalHeight)
	{
		var x0 = 0.0;
		for (var c = 0; c < cell.Column && c < layout.ColWidths.Length; c++) x0 += layout.ColWidths[c] + ColumnSpacing;
		var width = 0.0;
		for (var c = cell.Column; c < cell.Column + cell.ColumnSpan && c < layout.ColWidths.Length; c++)
		{
			width += layout.ColWidths[c];
			if (c > cell.Column) width += ColumnSpacing;
		}

		// Row 0 sits at the TOP. Row r's top-edge offset from grid bottom = totalHeight -
		// sum of heights of rows [0..r] - spacings.
		var topFromBottom = totalHeight;
		for (var r = 0; r < cell.Row && r < layout.RowHeights.Length; r++) topFromBottom -= layout.RowHeights[r] + RowSpacing;

		var height = 0.0;
		for (var r = cell.Row; r < cell.Row + cell.RowSpan && r < layout.RowHeights.Length; r++)
		{
			height += layout.RowHeights[r];
			if (r > cell.Row) height += RowSpacing;
		}

		var bottomFromBottom = topFromBottom - height;
		return new BoundingBox(x0, bottomFromBottom, x0 + width, topFromBottom);
	}
}
