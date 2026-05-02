using System;
using System.Collections.Generic;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Layout;

// Phase 7: paragraph layout. Wraps `Text` to fit a width (mm) using FontMetrics for line
// breaking, then resolves to a stack of TextElements — one per line. Hard newlines in the
// input force a paragraph break.
//
// Width semantics:
//   null  → auto-fill: use the parent's available width (from LayoutContext). Falls back to
//           "no wrap" only when the parent provides no width (unconstrained context).
//   >0    → fixed wrap width.
// This lets a TextFlow inside a Page/Frame/Stack/Grid wrap to its container without the
// user having to pre-compute it.
//
// Anchor: the resulting block's TOP-LEFT corner sits at (Origin.X, Origin.Y + height) in
// world Y-up coords, so the FIRST line's baseline ends up at Origin.Y + height - ascent.
// When wrapped in a Frame the frame handles centring/padding.
public sealed class TextFlow : LayoutElement
{
	public string Text { get; init; } = string.Empty;
	public double? Width { get; init; }
	public TextStyle Style { get; init; } = new TextStyle();
	public Point2D Origin { get; init; } = Point2D.Zero;

	// Optional: when set, the resolved bounding box reports this height instead of the
	// natural multi-line height. Useful for cells with fixed row heights.
	public double? FixedHeight { get; init; }

	public override BoundingBox ComputeBounds() => ComputeBounds(new LayoutContext(BoundingBox.Empty));

	public override BoundingBox ComputeBounds(LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, _) = LayoutLines(Style, Text, effectiveWidth);
		var w = effectiveWidth > 0 ? effectiveWidth : MaxLineWidth(lines, Style);
		var h = FixedHeight ?? Math.Max(lineHeight, lines.Count * lineHeight);
		return new BoundingBox(Origin.X, Origin.Y, Origin.X + w, Origin.Y + h);
	}

	// Pagination: split at line boundaries. Wrap once, then bin-pack lines into the budget.
	// The fits half keeps Origin; the overflow half resets to (0,0) so PaginationPass can
	// re-anchor it on the next page. FixedHeight is dropped on overflow because the fixed
	// height described the original whole flow.
	public override SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		var effectiveWidth = ResolveEffectiveWidth(context);
		var (lines, lineHeight, _) = LayoutLines(Style, Text, effectiveWidth);
		if (lines.Count == 0 || lineHeight <= 0)
			return base.TrySplit(availableHeight, context);

		var fitsLineCount = (int)Math.Floor((availableHeight + 1e-6) / lineHeight);
		if (fitsLineCount <= 0)
			return SplitResult.NothingFits(this);

		if (fitsLineCount >= lines.Count)
			return base.TrySplit(availableHeight, context);

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

	// Width resolution: explicit Width wins; otherwise inherit from the parent's
	// available rect; otherwise 0 (= no wrapping). 0 means "single-line per paragraph"
	// because the wrap loop in LayoutLines short-circuits when width <= 0.
	private double ResolveEffectiveWidth(LayoutContext context)
	{
		if (Width.HasValue) return Math.Max(0, Width.Value);
		var available = context.AvailableWidth;
		if (double.IsInfinity(available) || available <= 0) return 0;
		return available;
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
