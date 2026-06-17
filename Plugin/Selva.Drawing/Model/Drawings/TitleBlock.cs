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
// Localizable caption set for the title-block factories. Each property is the small-caps
// label shown above a value cell. Defaults are English (ISO drafting convention); German()
// supplies the equivalent DIN/ISO German captions. Callers can also build a custom set.
public sealed class TitleBlockLabels
{
	public string LegalOwner { get; init; } = "LEGAL OWNER";
	public string Client { get; init; } = "CLIENT";
	public string Project { get; init; } = "PROJECT";
	public string Title { get; init; } = "TITLE";
	public string DrawingNumber { get; init; } = "DRAWING NO.";
	public string Revision { get; init; } = "REV";
	public string Scale { get; init; } = "SCALE";
	public string Sheet { get; init; } = "SHEET";
	public string CreatedBy { get; init; } = "CREATED BY";
	public string Drawn { get; init; } = "DRAWN";
	public string ApprovedBy { get; init; } = "APPROVED BY";
	public string Checked { get; init; } = "CHECKED";
	public string Date { get; init; } = "DATE";
	public string DateOfIssue { get; init; } = "DATE OF ISSUE";

	public static readonly TitleBlockLabels English = new TitleBlockLabels();

	public static readonly TitleBlockLabels German = new TitleBlockLabels
	{
		LegalOwner = "EIGENTÜMER",
		Client = "KUNDE",
		Project = "PROJEKT",
		Title = "TITEL",
		DrawingNumber = "ZEICHNUNGS-NR.",
		Revision = "ÄND",
		Scale = "MASSSTAB",
		Sheet = "BLATT",
		CreatedBy = "ERSTELLT VON",
		Drawn = "GEZEICHNET",
		ApprovedBy = "GENEHMIGT VON",
		Checked = "GEPRÜFT",
		Date = "DATUM",
		DateOfIssue = "AUSGABEDATUM",
	};
}

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

	// ISO 7200 width rule: on A4-and-narrower sheets the title block spans the full content
	// width; on A3 and larger it stays a fixed strip pinned to the bottom-right corner. When
	// AutoWidth is set, Resolve stretches the block to the band's available width if that width
	// is below IsoFullWidthThreshold, otherwise it keeps Size.Width. The component that wires the
	// block into chrome flips the footer alignment (Right vs full-width) on the same signal.
	public bool AutoWidth { get; init; }

	// Sheets at or below this content width (mm) get a full-width block. ~200mm covers A4
	// portrait (210mm paper − margins) without catching A3 landscape's 180mm corner block.
	public const double IsoFullWidthThreshold = 200.0;

	// Fixed fraction of the block width reserved for the logo column in the ISO 7200 layout. The
	// owner / project cells split the rest. ~20% of a 180mm block ≈ 36mm — a comfortable logo
	// strip that still leaves the bulk of the row for the two names.
	public const double LogoColumnSpan = 0.2;

	// Optional logo rendered in a dedicated cell. Placed top-left and aspect-preserved, fitted
	// into the first row's logo column (row 0, column 0) so it never bleeds into the owner /
	// project cells next to it. Null = no logo cell.
	public ImageElement Logo { get; init; }

	// Hard cap on the rendered logo box (mm). The logo is fitted into a box no wider than
	// LogoMaxWidth and no taller than LogoMaxHeight (each ignored when <= 0), then aspect-
	// preserved within it. The logo column width is an additional, automatic cap. Defaults
	// leave the column as the only constraint.
	public double LogoMaxWidth { get; init; }
	public double LogoMaxHeight { get; init; }

	public Stroke Border { get; init; } = new Stroke { Width = 0.35 };
	public Stroke InnerBorder { get; init; } = new Stroke { Width = 0.18 };

	public TextStyle LabelStyle { get; init; } = new TextStyle { FontSize = 1.8, Color = Color.Black };
	public TextStyle ValueStyle { get; init; } = new TextStyle { FontSize = 3.0, Weight = FontWeight.Bold };
	public Margins CellPadding { get; init; } = new Margins(1.5, 2, 1.5, 2);

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		// ISO 7200: full-width on A4-and-narrower bands, fixed Size.Width on larger sheets.
		var totalWidth = ResolveWidth(context);
		var totalHeight = Size.Height;

		if (Rows == null || Rows.Count == 0)
		{
			// Empty block: just the outer rect.
			return new Frame
			{
				Size = new BoundingBox(0, 0, totalWidth, totalHeight),
				Border = Border,
				Origin = Origin,
			}.Resolve(context);
		}
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

		// Logo overlays the top-left, fitted into the first row's logo cell (height + the cell's
		// own width) with a small inset and aspect preserved. Drawn last so it sits over the field
		// grid (the standard layout keeps the top-left cell blank for it).
		if (Logo != null)
			children.Add(PlaceLogo(Logo, rowHeight, LogoCellWidth(totalWidth)));

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

	// ISO 7200 width: when AutoWidth is set and the band is A4-narrow, stretch to the band's
	// available width; otherwise keep the fixed Size.Width. A degenerate/empty context (no band
	// known yet, e.g. band-height measurement) falls back to Size.Width.
	private double ResolveWidth(LayoutContext context)
	{
		if (!AutoWidth || !context.HasFiniteAvailableWidth) return Size.Width;
		var available = context.AvailableWidth;
		return available <= IsoFullWidthThreshold ? available : Size.Width;
	}

	// Width of the logo cell — row 0, column 0 — under the resolved total width. This is the
	// automatic width cap that keeps a wide logo from spilling into the owner / project cells.
	private double LogoCellWidth(double totalWidth)
	{
		if (Rows == null || Rows.Count == 0) return totalWidth;
		var firstRow = Rows[0];
		if (firstRow == null || firstRow.Count == 0) return totalWidth;
		return ResolveColumnWidths(firstRow, totalWidth)[0];
	}

	// Fit the logo into the top-left logo cell: a box one row tall and one logo-cell wide (each
	// minus inset), pinned to the top-left corner, aspect preserved. The box is the tightest of
	// the cell extent and the optional LogoMaxWidth / LogoMaxHeight caps; the logo is then scaled
	// to fit inside it without overflowing into the neighbouring cells. Honours the image's
	// intrinsic aspect when both Width and Height are set; otherwise assumes square.
	private DrawElement PlaceLogo(ImageElement logo, double rowHeight, double cellWidth)
	{
		const double inset = 1.5;
		var boxHeight = Math.Max(0, rowHeight - inset * 2);
		var boxWidth = Math.Max(0, cellWidth - inset * 2);
		if (LogoMaxHeight > 0) boxHeight = Math.Min(boxHeight, LogoMaxHeight);
		if (LogoMaxWidth > 0) boxWidth = Math.Min(boxWidth, LogoMaxWidth);

		var srcW = logo.Width > 0 ? logo.Width : boxHeight;
		var srcH = logo.Height > 0 ? logo.Height : boxHeight;
		var aspect = srcH > 0 ? srcW / srcH : 1.0;

		// Fit aspect-preserved inside the box: start height-bound, shrink if that overflows width.
		var drawH = boxHeight;
		var drawW = drawH * aspect;
		if (boxWidth > 0 && drawW > boxWidth)
		{
			drawW = boxWidth;
			drawH = aspect > 0 ? drawW / aspect : boxHeight;
		}

		// Top-left of the block: y from (top − inset − drawH) up to (top − inset).
		var x = Origin.X + inset;
		var y = Origin.Y + Size.Height - inset - drawH;

		return new ImageElement
		{
			Data = logo.Data,
			Format = logo.Format,
			Position = new Point2D(x, y),
			Width = drawW,
			Height = drawH,
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
	public static TitleBlock Standard(IReadOnlyDictionary<string, string> values, BoundingBox? size = null, TitleBlockLabels labels = null)
	{
		string V(string k) => values != null && values.TryGetValue(k, out var v) ? v : string.Empty;
		var L = labels ?? TitleBlockLabels.English;

		return new TitleBlock
		{
			Size = size ?? new BoundingBox(0, 0, 180, 40),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				new[] { new TitleBlockField { Label = L.Project, Value = V("Project"), Span = 0.6 },
				        new TitleBlockField { Label = L.Client, Value = V("Client"), Span = 0.4 } },
				new[] { new TitleBlockField { Label = L.Title, Value = V("Title"), Span = 1.0 } },
				new[] { new TitleBlockField { Label = L.DrawingNumber, Value = V("DrawingNumber"), Span = 0.4 },
				        new TitleBlockField { Label = L.Revision, Value = V("Revision"), Span = 0.15 },
				        new TitleBlockField { Label = L.Scale, Value = V("Scale"), Span = 0.2 },
				        new TitleBlockField { Label = L.Sheet, Value = V("Sheet"), Span = 0.25 } },
				new[] { new TitleBlockField { Label = L.Drawn, Value = V("Author"), Span = 0.4 },
				        new TitleBlockField { Label = L.Date, Value = V("Date"), Span = 0.3 },
				        new TitleBlockField { Label = L.Checked, Value = V("Checker"), Span = 0.3 } },
			},
		};
	}

	// ISO 7200 full title block (first sheet). Data fields follow the standard's mandatory and
	// optional set: title, legal owner, drawing number, sheet n/N, revision, date of issue,
	// created/approved by, scale. The top-left cell is left blank so a Logo can overlay it.
	// Keys match GH_DocumentInfo / GH_TitleBlock token names; missing keys render blank.
	public static TitleBlock Iso7200(IReadOnlyDictionary<string, string> values, BoundingBox? size = null, TitleBlockLabels labels = null)
	{
		string V(string k) => values != null && values.TryGetValue(k, out var v) ? v : string.Empty;
		var L = labels ?? TitleBlockLabels.English;

		return new TitleBlock
		{
			Size = size ?? new BoundingBox(0, 0, 180, 50),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				// Row 1: blank logo cell (top-left, fixed ~20% so a logo always has room) + legal
				// owner / project. Owner and project are auto-width (Span = 0): they split the
				// remaining ~80% and grow to fill it, so long names get the space — while the logo
				// column stays a predictable fixed width regardless of name length.
				new[] { new TitleBlockField { Span = LogoColumnSpan },
				        new TitleBlockField { Label = L.LegalOwner, Value = V("Owner") },
				        new TitleBlockField { Label = L.Project, Value = V("Project") } },
				new[] { new TitleBlockField { Label = L.Title, Value = V("Title"), Span = 1.0 } },
				new[] { new TitleBlockField { Label = L.DrawingNumber, Value = V("DrawingNumber"), Span = 0.35 },
				        new TitleBlockField { Label = L.Revision, Value = V("Revision"), Span = 0.15 },
				        new TitleBlockField { Label = L.Scale, Value = V("Scale"), Span = 0.25 },
				        new TitleBlockField { Label = L.Sheet, Value = V("Sheet"), Span = 0.25 } },
				new[] { new TitleBlockField { Label = L.CreatedBy, Value = V("Author"), Span = 0.35 },
				        new TitleBlockField { Label = L.ApprovedBy, Value = V("Approver"), Span = 0.35 },
				        new TitleBlockField { Label = L.DateOfIssue, Value = V("Date"), Span = 0.3 } },
			},
		};
	}

	// ISO continuation-sheet strip: a single slim row carrying just enough to identify the sheet
	// if printed and separated — drawing number, title, revision, sheet n/N. Used as the
	// document-default footer on pages after the first.
	public static TitleBlock Continuation(IReadOnlyDictionary<string, string> values, BoundingBox? size = null, TitleBlockLabels labels = null)
	{
		string V(string k) => values != null && values.TryGetValue(k, out var v) ? v : string.Empty;
		var L = labels ?? TitleBlockLabels.English;

		return new TitleBlock
		{
			Size = size ?? new BoundingBox(0, 0, 180, 12),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				new[] { new TitleBlockField { Label = L.DrawingNumber, Value = V("DrawingNumber"), Span = 0.3 },
				        new TitleBlockField { Label = L.Title, Value = V("Title"), Span = 0.45 },
				        new TitleBlockField { Label = L.Revision, Value = V("Revision"), Span = 0.1 },
				        new TitleBlockField { Label = L.Sheet, Value = V("Sheet"), Span = 0.15 } },
			},
		};
	}
}
