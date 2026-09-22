using System;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

// Single-run text positioned at a point. Bounds come from FontMetrics when the font is
// bundled, or a char-count heuristic for unrecognized user-supplied fonts.
public sealed class TextElement : DrawElement
{
	public string Text { get; init; } = string.Empty;
	public Point2D Position { get; init; }
	public TextStyle Style { get; init; } = new TextStyle();
	public double RotationDegrees { get; init; }

	// Pre-computed bounds from a layout pass; overrides FontMetrics when set.
	public BoundingBox? MeasuredBounds { get; init; }

	// Renderers emit a clickable link over the text's bounds when set: SVG wraps the run
	// in <a href>, PDF emits a /Link annotation via PdfPage.AddWebLink.
	public string Hyperlink { get; init; }

	// Background fill behind the glyphs, expanded by BackgroundPadding with corners
	// rounded by BackgroundCornerRadius. Ignored when null.
	public Color? Background { get; init; }
	public double BackgroundPadding { get; init; }
	public double BackgroundCornerRadius { get; init; }

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
		// Ascent/descent, not a fixed box: cap height and descenders come out correctly.
		var ascent = measured.Ascent;
		var descent = Math.Abs(measured.Descent);
		// LineHeight scales total height like CSS line-height, for looser layout.
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

		if (Background.HasValue && BackgroundPadding > 0)
		{
			var p = BackgroundPadding;
			minX -= p; maxX += p; minY -= p; maxY += p;
		}


		if (RotationDegrees != 0)
		{
			// Renderers rotate the run about Position (translate → scale(1,-1) → rotate(-deg),
			// which in this Y-up space is +deg counter-clockwise). Bounds must follow, or a
			// rotated run's box stays axis-aligned and layout fits against ink that isn't there.
			var rad = RotationDegrees * Math.PI / 180.0;
			var cos = Math.Cos(rad);
			var sin = Math.Sin(rad);
			var rotated = BoundingBox.Empty;
			foreach (var corner in new[]
			{
				new Point2D(minX, minY), new Point2D(maxX, minY),
				new Point2D(maxX, maxY), new Point2D(minX, maxY)
			})
			{
				var dx = corner.X - Position.X;
				var dy = corner.Y - Position.Y;
				rotated = rotated.Union(new Point2D(
					Position.X + dx * cos - dy * sin,
					Position.Y + dx * sin + dy * cos));
			}
			return rotated;
		}

		return new BoundingBox(minX, minY, maxX, maxY);
	}
}
