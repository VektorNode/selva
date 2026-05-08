using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Drawings;

// Phase 8 composite: a single revision history entry — drawn as one row of a RevisionTable.
public sealed class RevisionEntry
{
	public string Revision { get; init; }
	public string Date { get; init; }
	public string Description { get; init; }
	public string By { get; init; }
}

// Phase 8 composite: bordered, headered table tracking drawing revisions. The four standard
// columns (Rev / Date / Description / By) reflect drafting-spec convention; Description is
// the only flex column. Wraps Phase 7's `Table` so styling and rendering go through the
// same code path as a hand-rolled table.
public sealed class RevisionTable : LayoutElement
{
	public IReadOnlyList<RevisionEntry> Entries { get; init; } = Array.Empty<RevisionEntry>();

	// Total table width. The Description column is a Star track; the remaining columns are
	// absolute. Defaults match a typical right-side block on an A3 sheet.
	public double Width { get; init; } = 120;

	public double RevisionColumnWidth { get; init; } = 12;
	public double DateColumnWidth { get; init; } = 22;
	public double ByColumnWidth { get; init; } = 18;

	public Stroke Border { get; init; } = new Stroke { Width = 0.25 };
	public TextStyle CellStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public TextStyle HeaderStyle { get; init; }
	public Fill HeaderBackground { get; init; }
	public Margins CellPadding { get; init; } = new Margins(1, 2, 1, 2);

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		// Description column = Width - sum of fixed columns (clamped at zero).
		var descWidth = Math.Max(10, Width - RevisionColumnWidth - DateColumnWidth - ByColumnWidth);

		var table = new Table
		{
			Origin = Origin,
			ColumnWidths = new[]
			{
				GridLength.Absolute(RevisionColumnWidth),
				GridLength.Absolute(DateColumnWidth),
				GridLength.Absolute(descWidth),
				GridLength.Absolute(ByColumnWidth),
			},
			Header = new[]
			{
				new TableCell { Text = "REV" },
				new TableCell { Text = "DATE" },
				new TableCell { Text = "DESCRIPTION" },
				new TableCell { Text = "BY" },
			},
			Rows = BuildRows(),
			Border = Border,
			DefaultCellStyle = CellStyle,
			HeaderStyle = HeaderStyle,
			HeaderBackground = HeaderBackground,
			CellPadding = CellPadding,
		};

		return table.Resolve(context);
	}

	private IReadOnlyList<IReadOnlyList<TableCell>> BuildRows()
	{
		var list = new List<IReadOnlyList<TableCell>>(Entries.Count);
		foreach (var e in Entries)
		{
			list.Add(new[]
			{
				new TableCell { Text = e?.Revision ?? string.Empty },
				new TableCell { Text = e?.Date ?? string.Empty },
				new TableCell { Text = e?.Description ?? string.Empty },
				new TableCell { Text = e?.By ?? string.Empty },
			});
		}
		return list;
	}
}
