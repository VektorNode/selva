using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Drawings;

// Drawing title block: a bordered grid of named fields, each cell a label (small caps)
// above a value (larger). Rows of TitleBlockField drive placement — fields in a row share
// its height; column widths come from Span (fraction of row width) or split evenly at
// Span = 0.
// Localizable caption set. English is the ISO drafting-convention default; German supplies
// the DIN/ISO equivalents. Callers can also build a custom set.
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
	public string Label { get; init; }
	public string Value { get; init; }

	// Fields with Span = 0 split whatever width remains after explicit-span fields.
	public double Span { get; init; }

	public TextStyle LabelStyle { get; init; }
	public TextStyle ValueStyle { get; init; }
}

public sealed class TitleBlock : LayoutElement
{
	// Rows stack top-to-bottom; a null entry inside a row is a blank cell.
	public IReadOnlyList<IReadOnlyList<TitleBlockField>> Rows { get; init; }
		= Array.Empty<IReadOnlyList<TitleBlockField>>();

	// 180x40mm fits comfortably in an A3 corner.
	public BoundingBox Size { get; init; } = new BoundingBox(0, 0, 180, 40);

	public bool AutoWidth { get; init; }

	// 420mm ≈ A3's long edge — beyond it the block stops growing.
	public const double MaxAutoWidth = 420.0;

	// ~20% of a 180mm block ≈ 36mm — enough for a logo strip while leaving most of the
	// row for the owner / project names.
	public const double LogoColumnSpan = 0.2;

	// Placed top-left, aspect-preserved, fitted into row 0's logo column. Null = no logo cell.
	public ImageElement Logo { get; init; }

	// Each cap is ignored when <= 0; the logo column width is an additional automatic cap.
	public double LogoMaxWidth { get; init; }
	public double LogoMaxHeight { get; init; }

	public Stroke Border { get; init; } = new Stroke { Width = LineWeight.Medium };
	public Stroke InnerBorder { get; init; } = new Stroke { Width = LineWeight.ExtraFine };

	public TextStyle LabelStyle { get; init; } = new TextStyle { FontSize = 1.8, Color = Color.Black };
	public TextStyle ValueStyle { get; init; } = new TextStyle { FontSize = 3.0, Weight = FontWeight.Bold };
	public Margins CellPadding { get; init; } = new Margins(1.5, 2, 1.5, 2);

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		var totalWidth = ResolveWidth(context);
		var totalHeight = Size.Height;

		if (Rows == null || Rows.Count == 0)
		{
			return new Frame
			{
				Size = new BoundingBox(0, 0, totalWidth, totalHeight),
				Border = Border,
				Origin = Origin,
			}.Resolve(context);
		}
		var rowHeight = totalHeight / Rows.Count;

		var gridCells = new List<GridCell>();
		var rowTracks = new List<GridLength>();
		var colTracks = new List<GridLength>();

		// Grid takes one shared column track for all rows, but title-block rows need
		// independent column counts — so each row gets its own Grid, stacked vertically.
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

		// Vertical Stack's first child sits at the top in Y-up world, matching reading order.
		var stack = new Stack
		{
			Children = rowElements,
			Orientation = StackOrientation.Vertical,
			Spacing = 0,
			CrossAlign = CrossAlign.Stretch,
			Origin = new Point2D(Origin.X, Origin.Y),
		};

		var children = new List<DrawElement>();
		children.Add(stack);

		var borderPath = BuildBorderPath(totalWidth, totalHeight, rowHeight);
		if (Border != null)
			children.Add(new PathElement { Path = borderPath, Stroke = Border });

		// Drawn last so it layers over the field grid; the standard layouts leave the
		// top-left cell blank for it.
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

	// Falls back to Size.Width when the band's available width isn't known yet
	// (e.g. during band-height measurement).
	private double ResolveWidth(LayoutContext context)
	{
		if (!AutoWidth || !context.HasFiniteAvailableWidth) return Size.Width;
		return Math.Min(context.AvailableWidth, MaxAutoWidth);
	}

	private double LogoCellWidth(double totalWidth)
	{
		if (Rows == null || Rows.Count == 0) return totalWidth;
		var firstRow = Rows[0];
		if (firstRow == null || firstRow.Count == 0) return totalWidth;
		return ResolveColumnWidths(firstRow, totalWidth)[0];
	}

	// Fits the logo, aspect-preserved, into a box no bigger than the logo cell or the
	// LogoMax* caps, whichever is tighter. Assumes square if the image has no intrinsic size.
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

		// Spans summing to <= 1 are fractions of total width; above that they're treated as
		// proportional weights instead. Auto fields split whatever's left.
		double explicitWidthTotal;
		if (explicitTotal > 0 && explicitTotal <= 1.0)
		{
			explicitWidthTotal = explicitTotal * totalWidth;
		}
		else
		{
			// No auto fields: explicit fields fill 100% instead of just their weight share.
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

		b.MoveTo(x0, y0).LineTo(x1, y0).LineTo(x1, y1).LineTo(x0, y1).Close();

		var cursorY = y1;
		for (var r = 0; r < Rows.Count - 1; r++)
		{
			cursorY -= rowHeight;
			b.MoveTo(x0, cursorY).LineTo(x1, cursorY);
		}

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

	// Title spans full width, then project/drawing/scale/sheet, then revision/date/author.
	// Missing keys render as blanks.
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

	// ISO 7200 full title block (first sheet): title, legal owner, drawing number, revision,
	// date of issue, created/approved by, scale. Top-left cell is left blank so a Logo can
	// overlay it. Keys match GH_DocumentInfo / GH_TitleBlock token names; missing keys render blank.
	public static TitleBlock Iso7200(IReadOnlyDictionary<string, string> values, BoundingBox? size = null, TitleBlockLabels labels = null)
	{
		string V(string k) => values != null && values.TryGetValue(k, out var v) ? v : string.Empty;
		var L = labels ?? TitleBlockLabels.English;

		return new TitleBlock
		{
			Size = size ?? new BoundingBox(0, 0, 180, 50),
			Rows = new IReadOnlyList<TitleBlockField>[]
			{
				// Owner/project are auto-width (Span = 0), so they split the ~80% left by the
				// fixed logo column and grow with long names; the logo column stays predictable.
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

	// Slim footer strip for pages after the first: drawing number, title, revision, sheet.
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
