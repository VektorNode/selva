using System;
using System.Collections.Generic;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Layout;

// Phase 7: paragraph layout. Wraps `Text` to fit `Width` (mm) using FontMetrics for line
// breaking, then resolves to a stack of TextElements — one per line. Hard newlines in the
// input force a paragraph break.
//
// Anchor: the resulting block's TOP-LEFT corner sits at (Origin.X, Origin.Y + height) in
// world Y-up coords, so the FIRST line's baseline ends up at Origin.Y + height - ascent.
// When wrapped in a Frame the frame handles centring/padding.
public sealed class TextFlow : LayoutElement
{
	public string Text { get; init; } = string.Empty;
	public double Width { get; init; } = 0.0;
	public TextStyle Style { get; init; } = new TextStyle();
	public Point2D Origin { get; init; } = Point2D.Zero;

	// Optional: when set, the resolved bounding box reports this height instead of the
	// natural multi-line height. Useful for cells with fixed row heights.
	public double? FixedHeight { get; init; }

	public override BoundingBox ComputeBounds()
	{
		var (lines, lineHeight, _) = LayoutLines(Style, Text, Width);
		var w = Width > 0 ? Width : MaxLineWidth(lines, Style);
		var h = FixedHeight ?? Math.Max(lineHeight, lines.Count * lineHeight);
		return new BoundingBox(Origin.X, Origin.Y, Origin.X + w, Origin.Y + h);
	}

	public override DrawElement Resolve(LayoutContext context)
	{
		var (lines, lineHeight, ascent) = LayoutLines(Style, Text, Width);
		var children = new List<DrawElement>(lines.Count);
		var totalH = FixedHeight ?? Math.Max(lineHeight, lines.Count * lineHeight);

		// Place line i so its baseline sits at: top - ascent - i*lineHeight.
		// Top in world Y-up = Origin.Y + totalH.
		var top = Origin.Y + totalH;
		for (var i = 0; i < lines.Count; i++)
		{
			var baseline = top - ascent - i * lineHeight;
			children.Add(new TextElement
			{
				Text = lines[i],
				Position = new Point2D(Origin.X, baseline),
				Style = Style,
			});
		}

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
		};
	}

	// Greedy line-break using FontMetrics. Whitespace splits words; if a single word exceeds
	// `width` it still goes on its own line (no hyphenation). Preserves explicit \n.
	internal static (IReadOnlyList<string> Lines, double LineHeight, double Ascent) LayoutLines(
		TextStyle style, string text, double width)
	{
		style ??= new TextStyle();
		text ??= string.Empty;

		// Use a 1em probe to derive ascent/lineHeight. We pass empty string because we just
		// want metrics, not a measured advance.
		var probe = FontMetrics.Measure(string.Empty, style);
		var ascent = probe.Ascent;
		var lineHeight = (probe.Ascent + Math.Abs(probe.Descent) + probe.LineGap) * Math.Max(1.0, style.LineHeight);

		var lines = new List<string>();
		var paragraphs = text.Replace("\r\n", "\n").Split('\n');

		foreach (var paragraph in paragraphs)
		{
			if (width <= 0 || string.IsNullOrEmpty(paragraph))
			{
				lines.Add(paragraph);
				continue;
			}

			var words = paragraph.Split(' ');
			var current = new System.Text.StringBuilder();
			foreach (var word in words)
			{
				var candidate = current.Length == 0 ? word : current + " " + word;
				var advance = FontMetrics.Measure(candidate, style).Width;
				if (advance <= width || current.Length == 0)
				{
					if (current.Length > 0) current.Append(' ');
					current.Append(word);
				}
				else
				{
					lines.Add(current.ToString());
					current.Clear();
					current.Append(word);
				}
			}
			lines.Add(current.ToString());
		}

		if (lines.Count == 0) lines.Add(string.Empty);
		return (lines, lineHeight, ascent);
	}

	private static double MaxLineWidth(IReadOnlyList<string> lines, TextStyle style)
	{
		var max = 0.0;
		foreach (var line in lines)
		{
			var w = FontMetrics.Measure(line, style).Width;
			if (w > max) max = w;
		}
		return max;
	}
}
