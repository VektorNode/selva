using System;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

// Single-run text positioned at a point. Bounds come from real glyph metrics
// (Selva.Drawing.Fonts.FontMetrics) when the Style.FontFamily is bundled; otherwise we
// fall back to a 0.55 × charCount × fontSize heuristic so unknown user-supplied stacks
// still produce sensible bounds. MeasuredBounds, when set by an upstream layout pass,
// wins over both.
public sealed class TextElement : DrawElement
{
	public string Text { get; init; } = string.Empty;
	public Point2D Position { get; init; }
	public TextStyle Style { get; init; } = new TextStyle();
	public double RotationDegrees { get; init; }

	// Optional pre-computed bounds (from a layout pass). Null = derive from FontMetrics.
	public BoundingBox? MeasuredBounds { get; init; }

	// Optional URL — when set, renderers emit a clickable link annotation over the text's
	// bounding box. SVG wraps the run in <a href>; PDF emits a /Link annotation via
	// PdfPage.AddWebLink. Empty/null = no link.
	public string Hyperlink { get; init; }

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		if (MeasuredBounds.HasValue) return MeasuredBounds.Value;

		var style = Style ?? new TextStyle();
		var size = style.FontSize;
		if (size <= 0) return BoundingBox.FromPoint(Position);

		var measured = FontMetrics.Measure(Text ?? string.Empty, style);
		var width = measured.Width;
		// Per-line vertical extent above/below the baseline. We prefer ascent/descent so
		// glyph hangs (descenders) and cap height are captured correctly; LineHeight scales
		// the total box for callers who want loose layout.
		var ascent = measured.Ascent;
		var descent = Math.Abs(measured.Descent);
		// Apply LineHeight as a multiplier on total height (matches CSS line-height feel).
		var lineHeightMultiplier = Math.Max(1.0, style.LineHeight);
		var extra = (ascent + descent) * (lineHeightMultiplier - 1.0) * 0.5;
		ascent += extra;
		descent += extra;

		double minX, maxX;
		switch (style.HorizontalAnchor)
		{
			case TextAnchor.Center: minX = Position.X - width / 2; maxX = Position.X + width / 2; break;
			case TextAnchor.Right: minX = Position.X - width; maxX = Position.X; break;
			default: minX = Position.X; maxX = Position.X + width; break;
		}

		double minY, maxY;
		switch (style.VerticalAnchor)
		{
			case VerticalAnchor.Top: minY = Position.Y - (ascent + descent); maxY = Position.Y; break;
			case VerticalAnchor.Middle: minY = Position.Y - (ascent + descent) / 2; maxY = Position.Y + (ascent + descent) / 2; break;
			case VerticalAnchor.Bottom: minY = Position.Y; maxY = Position.Y + (ascent + descent); break;
			default: minY = Position.Y - descent; maxY = Position.Y + ascent; break;
		}

		return new BoundingBox(minX, minY, maxX, maxY);
	}
}
