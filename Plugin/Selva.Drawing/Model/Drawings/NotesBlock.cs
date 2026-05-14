using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Drawings;

// Phase 8 composite: numbered notes block. Each note is a paragraph of text rendered with
// real font measurement; the block stacks them top-to-bottom with a configurable gap.
//
// Auto-numbering: each note gets a "1." prefix (or per-note custom marker) inside a fixed-
// width gutter so multi-line notes wrap with a clean hanging indent.
public sealed class NotesBlock : LayoutElement
{
	public string Title { get; init; }
	public IReadOnlyList<string> Notes { get; init; } = Array.Empty<string>();

	// Optional explicit markers (e.g. "A.", "B."). When null, auto-numbering "1.", "2.", ...
	// is used. Length must match Notes when supplied; mismatched arrays fall back to auto.
	public IReadOnlyList<string> Markers { get; init; }

	public double Width { get; init; } = 90;
	public double GutterWidth { get; init; } = 6;
	public double NoteSpacing { get; init; } = 1.5;
	public double TitleSpacing { get; init; } = 2.0;

	public TextStyle TitleStyle { get; init; } = new TextStyle { FontSize = 3.0, Weight = FontWeight.Bold };
	public TextStyle NoteStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public TextStyle MarkerStyle { get; init; }

	public Point2D Origin { get; init; } = Point2D.Zero;

	public override DrawElement Resolve(LayoutContext context)
	{
		var children = new List<DrawElement>();

		if (!string.IsNullOrEmpty(Title))
		{
			children.Add(new TextFlow
			{
				Text = Title,
				Width = Width,
				Style = TitleStyle,
			});
		}

		var bodyTextWidth = Math.Max(10, Width - GutterWidth);
		var markerStyle = MarkerStyle ?? NoteStyle;

		for (var i = 0; i < Notes.Count; i++)
		{
			var marker = ResolveMarker(i);
			var note = Notes[i] ?? string.Empty;

			children.Add(new Grid
			{
				Columns = new[]
				{
					GridLength.Absolute(GutterWidth),
					GridLength.Absolute(bodyTextWidth),
				},
				Rows = new[] { GridLength.Auto },
				Cells = new[]
				{
					new GridCell
					{
						Row = 0, Column = 0,
						Content = new TextFlow { Text = marker, Width = GutterWidth, Style = markerStyle },
					},
					new GridCell
					{
						Row = 0, Column = 1,
						Content = new TextFlow { Text = note, Width = bodyTextWidth, Style = NoteStyle },
					},
				},
			});
		}

		var spacing = NoteSpacing;
		if (children.Count == 0)
		{
			return new GroupElement { Id = Id, CssClass = CssClass, Metadata = Metadata };
		}

		// Title gets a slightly bigger gap if both title + notes are present. We approximate
		// this by inserting a spacer note after the title; a proper Stack-with-per-child-
		// spacing isn't worth introducing for one use.
		var stack = new Stack
		{
			Origin = Origin,
			Orientation = StackOrientation.Vertical,
			Spacing = spacing,
			CrossAlign = CrossAlign.Start,
			Children = string.IsNullOrEmpty(Title)
				? children
				: BuildChildrenWithTitleSpacing(children, TitleSpacing - NoteSpacing),
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

	private string ResolveMarker(int index)
	{
		if (Markers != null && Markers.Count == Notes.Count)
		{
			return Markers[index] ?? string.Empty;
		}
		return (index + 1).ToString(CultureInfo.InvariantCulture) + ".";
	}

	private static IReadOnlyList<DrawElement> BuildChildrenWithTitleSpacing(List<DrawElement> children, double extraGap)
	{
		// First child is the title. We insert an empty TextFlow as a spacer if extraGap > 0.
		if (extraGap <= 0 || children.Count < 2) return children;
		var rebuilt = new List<DrawElement>(children.Count + 1);
		rebuilt.Add(children[0]);
		rebuilt.Add(new Frame { Size = new BoundingBox(0, 0, 0.001, extraGap) });
		for (var i = 1; i < children.Count; i++) rebuilt.Add(children[i]);
		return rebuilt;
	}
}
