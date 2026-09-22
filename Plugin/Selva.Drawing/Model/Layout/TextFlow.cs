using System;
using System.Collections.Generic;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Layout;

// Paragraph layout: wraps `Text` to fit a width (mm) using FontMetrics for line breaking,
// then resolves to a stack of TextElements, one per line. Hard newlines force a paragraph break.
//
// Width: null auto-fills from the parent's available width (LayoutContext), falling back to
// "no wrap" only when the parent provides none. >0 is a fixed wrap width. Lets a TextFlow
// inside a Page/Frame/Stack/Grid wrap to its container without the caller pre-computing it.
//
// The resolved block's top-left sits at (Origin.X, Origin.Y + height) in world Y-up coords,
// so the first line's baseline lands at Origin.Y + height - ascent.
public sealed class TextFlow : LayoutElement
{
	public string Text { get; init; } = string.Empty;
	public double? Width { get; init; }
	public TextStyle Style { get; init; } = new TextStyle();
	public Point2D Origin { get; init; } = Point2D.Zero;

	// When set, ComputeBounds/Resolve report this height instead of the natural multi-line
	// height. Useful for cells with a fixed row height.
	public double? FixedHeight { get; init; }

	public override BoundingBox ComputeBounds() => ComputeBounds(new LayoutContext(BoundingBox.Empty));

	public override BoundingBox ComputeBounds(LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, _) = LayoutLines(Style, Text, effectiveWidth);
		var w = InkWidth(lines, Style, effectiveWidth);
		var h = FixedHeight ?? Math.Max(lineHeight, lines.Count * lineHeight);
		return new BoundingBox(Origin.X, Origin.Y, Origin.X + w, Origin.Y + h);
	}

	// Splits at line boundaries: wrap once, then bin-pack lines into the budget. The fits
	// half keeps Origin; the overflow half resets to (0,0) so PaginationPass re-anchors it on
	// the next page. FixedHeight is dropped on overflow since it described the whole flow.
	public override SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, _) = LayoutLines(Style, Text, effectiveWidth);
		if (lines.Count == 0 || lineHeight <= 0)
			return base.TrySplit(availableHeight, context);

		// Guard before the cast: casting +Infinity to int yields int.MinValue, which reads as
		// "nothing fits" and makes pagination emit one line per page. DocumentLayoutPass passes
		// +Infinity for every KeepTogether section, so this is the common path, not an edge case.
		if (double.IsPositiveInfinity(availableHeight))
			return base.TrySplit(availableHeight, context);

		var fitsLineCount = (int)Math.Floor((availableHeight + 1e-6) / lineHeight);
		if (fitsLineCount <= 0)
			return SplitResult.NothingFits(this);

		if (fitsLineCount >= lines.Count)
			return base.TrySplit(availableHeight, context);

		return SplitAfterLine(fitsLineCount, lines, lineHeight, context);
	}

	// Budget below one line height: force out the first line anyway so pagination progresses.
	public override SplitResult ForcePlace(double availableHeight, LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, _) = LayoutLines(Style, Text, effectiveWidth);
		if (lines.Count <= 1 || lineHeight <= 0)
			return base.ForcePlace(availableHeight, context);
		return SplitAfterLine(1, lines, lineHeight, context);
	}

	private SplitResult SplitAfterLine(int fitsLineCount, IReadOnlyList<string> lines, double lineHeight, LayoutContext context)
	{
		var fitsLines = new List<string>(fitsLineCount);
		for (var i = 0; i < fitsLineCount; i++) fitsLines.Add(lines[i]);
		var overflowLines = new List<string>(lines.Count - fitsLineCount);
		for (var i = fitsLineCount; i < lines.Count; i++) overflowLines.Add(lines[i]);

		var fitsFlow = new TextFlow
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Text = string.Join("\n", fitsLines),
			Width = Width,
			Style = Style,
			Origin = Origin,
			FixedHeight = null,
		};
		var overflowFlow = new TextFlow
		{
			Text = string.Join("\n", overflowLines),
			Width = Width,
			Style = Style,
			Origin = Point2D.Zero,
		};

		var fitsResolved = fitsFlow.Resolve(context);
		var fitsBounds = fitsResolved?.ComputeBounds() ?? BoundingBox.Empty;
		var fitsHeight = fitsBounds.IsEmpty ? fitsLineCount * lineHeight : fitsBounds.Height;
		return SplitResult.Partial(fitsResolved, overflowFlow, fitsHeight);
	}

	public override DrawElement Resolve(LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, ascent) = LayoutLines(Style, Text, effectiveWidth);
		var children = new List<DrawElement>(lines.Count);
		var totalH = FixedHeight ?? Math.Max(lineHeight, lines.Count * lineHeight);

		// The renderer shifts the glyph run left by 0/half-width/full-width per
		// style.HorizontalAnchor, so pin Position.X to the matching point in the wrap
		// rectangle (Origin.X .. Origin.X + width). Falls back to Origin.X when no width is
		// known (unconstrained, single-line case).
		var style = Style ?? new TextStyle();
		double anchorX = Origin.X;
		if (effectiveWidth > 0)
		{
			anchorX = style.HorizontalAnchor switch
			{
				TextAnchor.Center => Origin.X + effectiveWidth / 2.0,
				TextAnchor.Right => Origin.X + effectiveWidth,
				_ => Origin.X,
			};
		}

		// Line i's baseline: top - ascent - i*lineHeight, top = Origin.Y + totalH (Y-up).
		var top = Origin.Y + totalH;
		for (var i = 0; i < lines.Count; i++)
		{
			var baseline = top - ascent - i * lineHeight;
			children.Add(new TextElement
			{
				Text = lines[i],
				Position = new Point2D(anchorX, baseline),
				Style = style,
			});
		}

		// Pin bounds to what ComputeBounds reports: the glyph union misses the line gap, so
		// without this the pagination budget and the measured layout disagree by up to one line.
		var boundsWidth = InkWidth(lines, style, effectiveWidth);
		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(Origin.X, Origin.Y, Origin.X + boundsWidth, Origin.Y + totalH),
		};
	}

	// Greedy line-break using FontMetrics. Whitespace splits words; a single word exceeding
	// `width` still goes on its own line (no hyphenation). Preserves explicit \n.
	internal static (IReadOnlyList<string> Lines, double LineHeight, double Ascent) LayoutLines(
		TextStyle style, string text, double width)
	{
		style ??= new TextStyle();
		text ??= string.Empty;

		// Empty-string probe: we want font metrics, not a measured advance.
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

	// Explicit Width wins; else the parent's available rect; else 0. LayoutLines
	// short-circuits at width <= 0, so 0 means "single line per paragraph, no wrap".
	private double ResolveEffectiveWidth(LayoutContext context)
	{
		if (Width.HasValue) return Math.Max(0, Width.Value);
		var available = context.AvailableWidth;
		if (double.IsInfinity(available) || available <= 0) return 0;
		return available;
	}

	// The width this flow actually occupies, as opposed to the width it was allowed to wrap
	// within: conflating the two made every width-filling container treat the wrap budget as
	// a measurement (an Auto column holding "Qty" sized itself to the full page width).
	//
	// Capped at effectiveWidth because an unbreakable word can overrun the wrap box, and
	// reporting more than the budget would push that overflow back onto the container.
	//
	// Not used by the Center/Right anchor math in Resolve: that still centers within the box
	// the caller asked to wrap in, not within the glyphs' own extent.
	private static double InkWidth(IReadOnlyList<string> lines, TextStyle style, double effectiveWidth)
	{
		var ink = MaxLineWidth(lines, style);
		if (effectiveWidth <= 0) return ink;
		return Math.Min(ink, effectiveWidth);
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
