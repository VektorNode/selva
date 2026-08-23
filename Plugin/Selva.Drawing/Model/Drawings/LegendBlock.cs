using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Drawings;

// One legend entry: a swatch (hatch tile, line sample, symbol) paired with a description.
public sealed class LegendEntry
{
	public DrawElement Swatch { get; init; }
	public string Description { get; init; }
}

// Two-column legend: fixed-width swatch cell + free-flowing description text. Optional
// Title sits above the table and uses TitleStyle.
public sealed class LegendBlock : LayoutElement
{
	public string Title { get; init; }
	public IReadOnlyList<LegendEntry> Entries { get; init; } = Array.Empty<LegendEntry>();

	public double Width { get; init; } = 80;
	public double SwatchColumnWidth { get; init; } = 18;

	public Stroke Border { get; init; } = new Stroke { Width = LineWeight.Fine };
	public TextStyle TitleStyle { get; init; } = new TextStyle { FontSize = 3.0, Weight = FontWeight.Bold };
	public TextStyle DescriptionStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public Margins CellPadding { get; init; } = new Margins(1.5, 2, 1.5, 2);

	// Vertical gap between title and the entry table. Ignored when Title is null/empty.
	public double TitleSpacing { get; init; } = 1.5;

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		var descriptionWidth = Math.Max(10, Width - SwatchColumnWidth);

		var rows = new List<IReadOnlyList<TableCell>>(Entries.Count);
		foreach (var entry in Entries)
		{
			rows.Add(new[]
			{
				new TableCell { Element = entry?.Swatch },
				new TableCell { Text = entry?.Description ?? string.Empty, Style = DescriptionStyle },
			});
		}

		var table = new Table
		{
			Origin = Point2D.Zero,
			ColumnWidths = new[] { GridLength.Absolute(SwatchColumnWidth), GridLength.Absolute(descriptionWidth) },
			Rows = rows,
			Border = Border,
			DefaultCellStyle = DescriptionStyle,
			CellPadding = CellPadding,
		};

		var children = new List<DrawElement>();

		if (string.IsNullOrEmpty(Title))
		{
			var resolvedTable = ((LayoutElement)new Table
			{
				Origin = Origin,
				ColumnWidths = table.ColumnWidths,
				Rows = table.Rows,
				Border = table.Border,
				DefaultCellStyle = table.DefaultCellStyle,
				CellPadding = table.CellPadding,
			}).Resolve(context);

			return new GroupElement
			{
				Id = Id,
				CssClass = CssClass,
				Metadata = Metadata,
				Children = new[] { resolvedTable },
				BoundsOverride = resolvedTable.ComputeBounds(),
			};
		}

		// Top-down stack matches reading order in Y-up world coords.
		var stack = new Stack
		{
			Origin = Origin,
			Orientation = StackOrientation.Vertical,
			Spacing = TitleSpacing,
			CrossAlign = CrossAlign.Start,
			Children = new DrawElement[]
			{
				new TextFlow { Text = Title, Width = Width, Style = TitleStyle },
				table,
			},
		};

		var resolved = stack.Resolve(context);
		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = new[] { resolved },
			BoundsOverride = resolved.ComputeBounds(),
		};
	}
}
