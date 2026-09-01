using System;
using System.Collections.Generic;
using System.Globalization;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Drawings;

// Numbered notes block. Each note gets a "1." prefix (or a custom marker) in a fixed-width
// gutter, so multi-line notes wrap with a hanging indent.
public sealed class NotesBlock : LayoutElement
{
	public string Title { get; init; }
	public IReadOnlyList<string> Notes { get; init; } = Array.Empty<string>();

	// Explicit markers (e.g. "A.", "B."); must match Notes in length or falls back to
	// auto-numbering "1.", "2.", ...
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
		var bodyTextWidth = Math.Max(10, Width - GutterWidth);
		var markerStyle = MarkerStyle ?? NoteStyle;

		var noteChildren = new List<DrawElement>();
		for (var i = 0; i < Notes.Count; i++)
		{
			var marker = ResolveMarker(i);
			var note = Notes[i] ?? string.Empty;

			noteChildren.Add(new Grid
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

		var hasTitle = !string.IsNullOrEmpty(Title);
		if (!hasTitle && noteChildren.Count == 0)
		{
			return new GroupElement { Id = Id, CssClass = CssClass, Metadata = Metadata };
		}

		// Notes nest in their own stack so NoteSpacing (between notes) and TitleSpacing
		// (title to notes) stay independent: a spacer child would apply the outer
		// spacing on both sides and inflate the title gap.
		var notesStack = new Stack
		{
			Orientation = StackOrientation.Vertical,
			Spacing = NoteSpacing,
			CrossAlign = CrossAlign.Start,
			Children = noteChildren,
		};

		var stack = new Stack
		{
			Origin = Origin,
			Orientation = StackOrientation.Vertical,
			Spacing = hasTitle ? TitleSpacing : NoteSpacing,
			CrossAlign = CrossAlign.Start,
			Children = hasTitle
				? new DrawElement[]
				{
					new TextFlow { Text = Title, Width = Width, Style = TitleStyle },
					notesStack,
				}
				: noteChildren,
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
}
