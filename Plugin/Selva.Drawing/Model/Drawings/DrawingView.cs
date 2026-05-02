using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Drawings;

// Phase 8 composite: a scaled view of geometry (curves, surfaces, dimensions, etc.) with an
// optional bordered frame and a caption. Wraps the visitor-visible geometry in a Group whose
// Transform = Translate(Origin) ∘ Translate(viewport-fit) ∘ Scale(Scale), so the model
// geometry's bounds at the input scale land inside the requested viewport.
//
// Two sizing modes:
//   - When Size is set, the view occupies that rectangle. The geometry is scaled by Scale
//     (default 1.0), then centred in the inner rect. Geometry that overflows the inner
//     rect is NOT clipped — that's the caller's responsibility (use a smaller Scale).
//     When Scale <= 0, the view auto-fits geometry into the inner rect uniformly
//     (uniform scale = min(innerW / geomW, innerH / geomH)) so callers can ask for a
//     fixed-size viewport without computing the scale themselves.
//   - When Size is null, the view sizes itself to fit the scaled geometry plus padding.
//
// The caption (if set) is a single-line label drawn below the frame's bottom edge, e.g.
// "SCALE 1:5" or a view name. Caption text uses CaptionStyle.
public sealed class DrawingView : LayoutElement
{
	public DrawElement Geometry { get; init; }

	// Drawing scale. 1.0 = full size in mm; 0.2 = 1:5; 2.0 = 2:1. Numeric only — formatting
	// for the caption is up to the caller via ScaleLabel.
	public double Scale { get; init; } = 1.0;

	// Optional fixed viewport size. When null, the view fits the scaled geometry + padding.
	public BoundingBox? Size { get; init; }

	public Stroke Border { get; init; }
	public Fill Background { get; init; }
	public Margins Padding { get; init; } = Margins.Uniform(2);

	// Bottom-left of the view's outer rect in world coords.
	public Point2D Origin { get; init; } = Point2D.Zero;

	// Optional caption shown below the frame (drawing title, scale label, etc.).
	public string Caption { get; init; }
	public TextStyle CaptionStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public double CaptionGap { get; init; } = 1.5;

	public override DrawElement Resolve(LayoutContext context)
	{
		var resolvedGeometry = Geometry is LayoutElement nested
			? nested.Resolve(new LayoutContext(BoundingBox.Empty))
			: Geometry;
		var geomBounds = resolvedGeometry?.ComputeBounds() ?? BoundingBox.Empty;

		// Inner viewport size = geometry-fit (scaled) when no fixed Size; otherwise use Size.
		double innerWidth, innerHeight;
		if (Size.HasValue)
		{
			innerWidth = Math.Max(0, Size.Value.Width - Padding.Left - Padding.Right);
			innerHeight = Math.Max(0, Size.Value.Height - Padding.Top - Padding.Bottom);
		}
		else if (geomBounds.IsEmpty)
		{
			innerWidth = 0;
			innerHeight = 0;
		}
		else
		{
			var unsizedScale = Scale > 0 ? Scale : 1.0;
			innerWidth = geomBounds.Width * unsizedScale;
			innerHeight = geomBounds.Height * unsizedScale;
		}

		// Resolve the actual scale used for placing geometry. Auto-fit kicks in only when a
		// fixed Size is supplied AND Scale <= 0 — otherwise we honour the caller's Scale even
		// if the geometry overflows the inner rect (matches the documented contract).
		var effectiveScale = Scale > 0 ? Scale : 1.0;
		if (Size.HasValue && Scale <= 0 && !geomBounds.IsEmpty && innerWidth > 0 && innerHeight > 0)
		{
			var fitX = innerWidth / geomBounds.Width;
			var fitY = innerHeight / geomBounds.Height;
			effectiveScale = Math.Min(fitX, fitY);
		}

		var outerWidth = innerWidth + Padding.Left + Padding.Right;
		var outerHeight = innerHeight + Padding.Top + Padding.Bottom;

		// Caption sits below the frame's bottom edge, so the resolved group's bounds extend
		// downward from Origin.Y by (caption gap + caption height).
		var captionMetrics = string.IsNullOrEmpty(Caption)
			? (Height: 0.0, Ascent: 0.0)
			: ComputeCaptionMetrics();

		var minX = Origin.X;
		var minY = Origin.Y - (captionMetrics.Height > 0 ? CaptionGap + captionMetrics.Height : 0);
		var maxX = Origin.X + outerWidth;
		var maxY = Origin.Y + outerHeight;

		var children = new List<DrawElement>(4);

		if (Background != null || Border != null)
		{
			var rect = new Path.Builder()
				.MoveTo(Origin.X, Origin.Y)
				.LineTo(Origin.X + outerWidth, Origin.Y)
				.LineTo(Origin.X + outerWidth, Origin.Y + outerHeight)
				.LineTo(Origin.X, Origin.Y + outerHeight)
				.Close()
				.Build();
			children.Add(new PathElement
			{
				Path = rect,
				Stroke = Border,
				Fill = Background,
			});
		}

		if (resolvedGeometry != null && !geomBounds.IsEmpty && innerWidth > 0 && innerHeight > 0)
		{
			// Centre the scaled geometry in the inner rect. Compose:
			//   1) translate so geometry's min corner ends up at (0,0)
			//   2) scale uniformly by effectiveScale
			//   3) translate to inner-rect bottom-left + centring offset
			var scaledW = geomBounds.Width * effectiveScale;
			var scaledH = geomBounds.Height * effectiveScale;
			var innerLeft = Origin.X + Padding.Left;
			var innerBottom = Origin.Y + Padding.Bottom;
			var dx = innerLeft + (innerWidth - scaledW) / 2.0;
			var dy = innerBottom + (innerHeight - scaledH) / 2.0;

			var t = Transform.Translate(-geomBounds.MinX, -geomBounds.MinY)
				.Then(Transform.Scale(effectiveScale))
				.Then(Transform.Translate(dx, dy));

			children.Add(new GroupElement
			{
				Transform = t,
				Children = new[] { resolvedGeometry },
			});
		}

		if (captionMetrics.Height > 0)
		{
			// Place caption baseline below the frame's bottom by (gap + ascent).
			var baseline = Origin.Y - CaptionGap - captionMetrics.Ascent;
			children.Add(new TextElement
			{
				Text = Caption,
				Position = new Point2D(Origin.X + outerWidth / 2.0, baseline),
				Style = new TextStyle
				{
					FontFamily = CaptionStyle.FontFamily,
					FontSize = CaptionStyle.FontSize,
					Weight = CaptionStyle.Weight,
					Style = CaptionStyle.Style,
					Decoration = CaptionStyle.Decoration,
					Color = CaptionStyle.Color,
					HorizontalAnchor = TextAnchor.Center,
					VerticalAnchor = VerticalAnchor.Baseline,
					LineHeight = CaptionStyle.LineHeight,
					LetterSpacing = CaptionStyle.LetterSpacing,
				},
			});
		}

		return new GroupElement
		{
			Id = Id,
			CssClass = CssClass,
			Metadata = Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(minX, minY, maxX, maxY),
		};
	}

	private (double Height, double Ascent) ComputeCaptionMetrics()
	{
		var probe = Fonts.FontMetrics.Measure(string.Empty, CaptionStyle ?? new TextStyle());
		var lineHeight = probe.Ascent + Math.Abs(probe.Descent) + probe.LineGap;
		return (lineHeight, probe.Ascent);
	}

	// Helper: format a numeric scale as a "1:N" / "N:1" / "1:1" caption.
	public static string FormatScaleLabel(double scale)
	{
		if (scale <= 0) return string.Empty;
		if (Math.Abs(scale - 1.0) < 1e-9) return "SCALE 1:1";
		if (scale < 1.0)
		{
			var n = 1.0 / scale;
			return $"SCALE 1:{FormatNumber(n)}";
		}
		return $"SCALE {FormatNumber(scale)}:1";
	}

	private static string FormatNumber(double n)
	{
		if (Math.Abs(n - Math.Round(n)) < 1e-6) return ((int)Math.Round(n)).ToString(System.Globalization.CultureInfo.InvariantCulture);
		return n.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
	}
}
