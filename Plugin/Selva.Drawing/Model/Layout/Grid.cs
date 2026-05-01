using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Phase 7: a CSS-grid-style track. Each track is one of:
//   Absolute(mm)   — fixed width/height
//   Auto           — sized to the largest natural size of its content
//   Star(weight)   — distributes remaining space proportionally (like CSS `1fr`)
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
// track space. Components surface these as runtime warnings — actionable feedback at
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

// Phase 7: a flex grid that resolves rows × columns and places each cell at the
// intersection. The grid's natural size honours absolute/auto tracks; star tracks expand
// to fill `LayoutContext.AvailableWidth`/`AvailableHeight` when the context is finite,
// otherwise they fall back to the largest auto-sized cell on that track.
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

		// Pin the resolved group's outer bounds to the resolved track totals. Stack/Frame/
		// Table consumers measure resolved-child bounds and need the grid's full track
		// extent — not just the union of cell content (which can be smaller than its track).
		var pinned = new BoundingBox(
			Origin.X, Origin.Y,
			Origin.X + total.Width, Origin.Y + total.Height);

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
		var (_, total) = ComputeLayout(new LayoutContext(BoundingBox.Empty));
		return new BoundingBox(Origin.X, Origin.Y, Origin.X + total.Width, Origin.Y + total.Height);
	}

	// Returns one entry per cell whose resolved content is larger than its allocated cell rect.
	// Caller passes the LayoutContext the grid will be laid out in; in standalone evaluation
	// (no parent context) pass `new LayoutContext(BoundingBox.Empty)` and only Absolute-track
	// overflows will be detected — Auto tracks always grow to fit, and Star tracks fall back
	// to natural sizes when available is infinite.
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

		for (var i = 0; i < Cells.Count; i++)
		{
			var c = Cells[i];
			var resolved = c.Content is LayoutElement nested
				? nested.Resolve(new LayoutContext(BoundingBox.Empty))
				: c.Content;
			resolvedCells[i] = resolved;
			cellBounds[i] = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		}

		var colWidths = ResolveTrackSizes(Columns, Cells, cellBounds, context.AvailableWidth, ColumnSpacing, isColumn: true);
		var rowHeights = ResolveTrackSizes(Rows, Cells, cellBounds, context.AvailableHeight, RowSpacing, isColumn: false);

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

		// Star tracks soak up whatever's left of `available` after fixed/auto. If available
		// is infinite (unconstrained context), each star track falls back to its largest
		// natural cell — same fallback as Auto.
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
			// Single-track cells contribute directly. Spanning cells contribute their natural
			// size divided evenly across the spanned tracks — keeps the arithmetic simple
			// and matches how most flex grids handle the spanning-auto case.
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
		// Y-up world: row 0 is the TOP row, so we accumulate downwards from the top of the
		// grid.
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
				// Top-left of the cell rect; place the child's top-left at that corner.
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
