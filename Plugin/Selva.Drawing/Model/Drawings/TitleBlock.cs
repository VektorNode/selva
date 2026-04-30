using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Drawings;

// Phase 8 composite: drawing title block. A bordered grid of named fields where each cell
// carries a label (small caps) above a value (larger). Field placement is driven by an
// ordered list of TitleBlockField rows — each row is a list of fields that share a row
// height, with column widths derived from explicit Span values (in fraction-of-row units)
// or distributed evenly when Span is 0.
//
// Standard helpers (`Standard()`, `Compact()`) produce conventional layouts so callers can
// fill a few fields and get a complete block.
public sealed class TitleBlockField
{
	// Short caption shown above the value, e.g. "PROJECT", "DRAWING NO".
	public string Label { get; init; }
	public string Value { get; init; }

	// Relative width within the row. Fields with Span = 0 take an even share of the row's
	// remaining width after explicit-span fields are subtracted.
	public double Span { get; init; }

	// Optional per-field overrides; null = inherit the block defaults.
	public TextStyle LabelStyle { get; init; }
	public TextStyle ValueStyle { get; init; }
}

public sealed class TitleBlock : LayoutElement
{
	// Each row is a list of fields; rows stack top-to-bottom in reading order. Empty
	// (null) entries inside a row produce blank cells.
	public IReadOnlyList<IReadOnlyList<TitleBlockField>> Rows { get; init; }
		= Array.Empty<IReadOnlyList<TitleBlockField>>();

	// Outer size. Defaults to 180×40mm — fits comfortably in an A3 corner. The renderer can
	// pin the block to any corner via Origin.
	public BoundingBox Size { get; init; } = new BoundingBox(0, 0, 180, 40);

	public Stroke Border { get; init; } = new Stroke { Width = 0.35 };
	public Stroke InnerBorder { get; init; } = new Stroke { Width = 0.18 };

	public TextStyle LabelStyle { get; init; } = new TextStyle { FontSize = 1.8, Color = Color.Black };
	public TextStyle ValueStyle { get; init; } = new TextStyle { FontSize = 3.0, Weight = FontWeight.Bold };
	public Margins CellPadding { get; init; } = new Margins(1.5, 2, 1.5, 2);

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		if (Rows == null || Rows.Count == 0)
		{
			// Empty block: just the outer rect.
			return new Frame
			{
				Size = new BoundingBox(0, 0, Size.Width, Size.Height),
				Border = Border,
				Origin = Origin,
			}.Resolve(context);
		}

		var totalWidth = Size.Width;
		var totalHeight = Size.Height;
		var rowHeight = totalHeight / Rows.Count;

		// Build the cell-content tree as a list of GridCells layered on top of a backing
		// Frame for the outer border.
		var gridCells = new List<GridCell>();
		var rowTracks = new List<GridLength>();
		var colTracks = new List<GridLength>();

		// We translate each row into a sub-grid: every row gets its own ColumnWidth array,
		// but Grid takes a single shared column track. So we instead emit one Grid per row
		// inside a vertical Stack — this gives independent column counts per row, which
		// real title blocks rely on.
		var rowElements = new List<DrawElement>(Rows.Count);
		for (var rIndex = 0; rIndex < Rows.Count; rIndex++)
		{
			var row = Rows[rIndex];
			if (row == null || row.Count == 0)
			{
				rowElements.Add(EmptyRow(totalWidth, rowHeight));
				continue;
			}

			var widths = ResolveColumnWidths(row, totalWidth);
			var cols = new GridLength[widths.Length];
			for (var c = 0; c < widths.Length; c++) cols[c] = GridLength.Absolute(widths[c]);

			var cells = new List<GridCell>(row.Count);
			for (var c = 0; c < row.Count; c++)
			{
				var field = row[c];
				if (field == null) continue;
				cells.Add(new GridCell
				{
					Row = 0,
					Column = c,
					Content = BuildFieldCell(field, widths[c], rowHeight),
				});
			}

			rowElements.Add(new Grid
			{
				Columns = cols,
				Rows = new[] { GridLength.Absolute(rowHeight) },
				Cells = cells,
				Origin = Point2D.Zero,
			});
		}

		// Stack rows top-to-bottom. Vertical Stack's first child sits at the top in Y-up
		// world, which matches the visual reading order.
		var stack = new Stack
		{
			Children = rowElements,
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			CrossAlign = CrossAlign.Stretch,
			Origin = new Point2D(Origin.X, Origin.Y),
		};

		// Build inner grid lines + outer border as a separate path for crisp rendering.
		var children = new List<DrawElement>();
		children.Add(stack);

		var borderPath = BuildBorderPath(totalWidth, totalHeight, rowHeight);
		if (Border != null)
			children.Add(new PathElement { Path = borderPath, Stroke = Border });

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(
				Origin.X, Origin.Y,
				Origin.X + totalWidth, Origin.Y + totalHeight),
		};
	}

	private DrawElement BuildFieldCell(TitleBlockField field, double width, double height)
	{
		var labelStyle = field.LabelStyle ?? LabelStyle;
		var valueStyle = field.ValueStyle ?? ValueStyle;

		// Label sits at the top-left of the inner padded rect; value fills the rest.
		var inner = new List<DrawElement>();

		if (!string.IsNullOrEmpty(field.Label))
		{
			inner.Add(new TextFlow
			{
				Text = field.Label,
				Width = Math.Max(0, width - CellPadding.Left - CellPadding.Right),
				Style = labelStyle,
			});
		}
		if (!string.IsNullOrEmpty(field.Value))
		{
			inner.Add(new TextFlow
			{
				Text = field.Value,
				Width = Math.Max(0, width - CellPadding.Left - CellPadding.Right),
				Style = valueStyle,
			});
		}

		var content = inner.Count == 0
			? (DrawElement)null
			: inner.Count == 1
				? inner[0]
				: new Stack
				{
					Children = inner,
					Orientation = StackOrientation.Vertical,
					Spacing = 0.5,
					CrossAlign = CrossAlign.Start,
				};

		return new Frame
		{
			Child = content,
			Size = new BoundingBox(0, 0, width, height),
			Padding = CellPadding,
		};
	}

	private DrawElement EmptyRow(double width, double height)
	{
		return new Frame
		{
			Size = new BoundingBox(0, 0, width, height),
			Padding = Margins.Zero,
		};
	}

	private double[] ResolveColumnWidths(IReadOnlyList<TitleBlockField> row, double totalWidth)
	{
		var widths = new double[row.Count];
		var explicitTotal = 0.0;
		var autoCount = 0;
		for (var i = 0; i < row.Count; i++)
		{
			var span = row[i]?.Span ?? 0;
			if (span > 0)
			{
				explicitTotal += span;
				widths[i] = -span;
			}
			else
			{
				autoCount++;
				widths[i] = 0;
			}
		}

		// Treat explicit Spans as fractions of total width when they sum to <= 1, otherwise
		// as proportional weights. Auto fields share whatever remains.
		double explicitWidthTotal;
		if (explicitTotal > 0 && explicitTotal <= 1.0)
		{
			explicitWidthTotal = explicitTotal * totalWidth;
		}
		else
		{
			// Proportional: each explicit weight becomes (weight / explicitTotal) × allocated.
			// If there are no auto fields, explicit fields fill 100%.
			explicitWidthTotal = autoCount == 0 ? totalWidth : Math.Min(explicitTotal, totalWidth);
		}

		var autoWidthTotal = Math.Max(0, totalWidth - explicitWidthTotal);
		var autoEach = autoCount > 0 ? autoWidthTotal / autoCount : 0;

		for (var i = 0; i < row.Count; i++)
		{
			if (widths[i] < 0)
			{
				var fraction = explicitTotal > 0 ? (-widths[i] / explicitTotal) : 0;
				widths[i] = explicitWidthTotal * fraction;
			}
			else
			{
				widths[i] = autoEach;
			}
		}

		return widths;
	}

	private Path BuildBorderPath(double totalWidth, double totalHeight, double rowHeight)
	{
		var b = new Path.Builder();
		var x0 = Origin.X;
		var y0 = Origin.Y;
		var x1 = Origin.X + totalWidth;
		var y1 = Origin.Y + totalHeight;

		// Outer rectangle.
		b.MoveTo(x0, y0).LineTo(x1, y0).LineTo(x1, y1).LineTo(x0, y1).Close();

		// Horizontal lines between rows.
		var cursorY = y1;
		for (var r = 0; r < Rows.Count - 1; r++)
		{
			cursorY -= rowHeight;
			b.MoveTo(x0, cursorY).LineTo(x1, cursorY);
		}

		// Vertical lines per row, between columns.
		cursorY = y1;
		for (var rIndex = 0; rIndex < Rows.Count; rIndex++)
		{
			var row = Rows[rIndex];
			cursorY -= rowHeight;
			if (row == null || row.Count <= 1) continue;
			var widths = ResolveColumnWidths(row, totalWidth);
			var cursorX = x0;
			for (var c = 0; c < widths.Length - 1; c++)
			{
				cursorX += widths[c];
				b.MoveTo(cursorX, cursorY).LineTo(cursorX, cursorY + rowHeight);
			}
		}

		return b.Build();
	}

	// Convenient builder: the drafting-spec staple — title at top spanning full width, then
	// a project/drawing/scale/sheet row, then revision/date/author. Callers fill the values
	// they care about; missing keys are rendered as blanks.
	public static TitleBlock Standard(IReadOnlyDictionary<string, string> values, BoundingBox? size = null)
	{
		string V(string k) => values != null && values.TryGetValue(k, out var v) ? v : string.Empty;

		return new TitleBlock
		{
			Size = size ?? new BoundingBox(0, 0, 180, 40),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				new[] { new TitleBlockField { Label = "PROJECT", Value = V("Project"), Span = 0.6 },
				        new TitleBlockField { Label = "CLIENT", Value = V("Client"), Span = 0.4 } },
				new[] { new TitleBlockField { Label = "TITLE", Value = V("Title"), Span = 1.0 } },
				new[] { new TitleBlockField { Label = "DRAWING NO", Value = V("DrawingNumber"), Span = 0.4 },
				        new TitleBlockField { Label = "REV", Value = V("Revision"), Span = 0.15 },
				        new TitleBlockField { Label = "SCALE", Value = V("Scale"), Span = 0.2 },
				        new TitleBlockField { Label = "SHEET", Value = V("Sheet"), Span = 0.25 } },
				new[] { new TitleBlockField { Label = "DRAWN", Value = V("Author"), Span = 0.4 },
				        new TitleBlockField { Label = "DATE", Value = V("Date"), Span = 0.3 },
				        new TitleBlockField { Label = "CHECKED", Value = V("Checker"), Span = 0.3 } },
			},
		};
	}
}
