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
// Sizing modes (resolved in order):
//   - Length set: pin the view's longest geometry side to Length mm; the other side follows
//     the geometry's aspect ratio. This is the common "I want this view to be ~80mm across"
//     ask without thinking about scale ratios.
//   - Size set: the view occupies that rectangle. Geometry is scaled by Scale (default 1.0)
//     then centred in the inner rect; Scale <= 0 means uniform-fit into the inner rect.
//   - Neither set + LayoutContext has finite bounds: auto-fit geometry into the available
//     bounds (the "drop it on a Page and it just works" path).
//   - Neither set + no parent bounds: fall back to natural size at Scale (default 1.0).
//
// In every case, geometry that overflows the inner rect is NOT clipped.
//
// The caption (if set) is a single-line label drawn below the frame's bottom edge, e.g.
// "SCALE 1:5" or a view name. Caption text uses CaptionStyle.
public sealed class DrawingView : LayoutElement
{
	// Metadata key under which the resolved view records the scale it actually rendered at
	// (numeric, e.g. "0.2" for 1:5). DocumentLayoutPass harvests this off the resolved body to
	// auto-fill the {scale} token in a title block, so an auto-fit view never needs its scale
	// typed in by hand. Present on the resolved GroupElement only when the scale is meaningful.
	public const string ScaleMetadataKey = "selva:scale";

	public DrawElement Geometry { get; init; }

	// Drawing scale. 1.0 = full size in mm; 0.2 = 1:5; 2.0 = 2:1. Numeric only — formatting
	// for the caption is up to the caller via ScaleLabel. Default 0 means "auto-fit" — the
	// view scales to its layout context (or falls back to 1.0 when no context is available).
	public double Scale { get; init; } = 0.0;

	// Optional fixed viewport size. When null, the view fits the scaled geometry + padding.
	public BoundingBox? Size { get; init; }

	// Convenience sizing: pin the geometry's longest side (post-padding inner rect) to this
	// length in mm. The shorter side follows from the geometry's aspect ratio. Wins over
	// Scale when set; ignored when Size is also set. Use this when you want "draw the view
	// at ~N millimetres" without computing the scale ratio yourself.
	public double? Length { get; init; }

	public Stroke Border { get; init; }
	public Fill Background { get; init; }
	public Margins Padding { get; init; } = Margins.Uniform(2);

	// Bottom-left of the view's outer rect in world coords.
	public Point2D Origin { get; init; } = Point2D.Zero;

	// Optional caption shown below the frame (drawing title, scale label, etc.).
	public string Caption { get; init; }

	// When true and no explicit Caption is set, the view auto-captions its inferred scale as
	// "SCALE 1:N" from the scale it actually resolved at. Lets a dropped-on-a-page view label
	// itself without the user computing the ratio. Ignored when Caption is set.
	public bool AutoScaleCaption { get; init; }
	public TextStyle CaptionStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public double CaptionGap { get; init; } = 1.5;

	public override DrawElement Resolve(LayoutContext context)
	{
		var resolvedGeometry = Geometry is LayoutElement nested
			? nested.Resolve(new LayoutContext(BoundingBox.Empty))
			: Geometry;
		var geomBounds = resolvedGeometry?.ComputeBounds() ?? BoundingBox.Empty;

		// Resolve sizing. Order: Length → Size → context auto-fit → natural size at Scale.
		double innerWidth, innerHeight, effectiveScale;
		if (Length.HasValue && Length.Value > 0 && !geomBounds.IsEmpty)
		{
			var longest = Math.Max(geomBounds.Width, geomBounds.Height);
			effectiveScale = longest > 0 ? Length.Value / longest : 1.0;
			innerWidth = geomBounds.Width * effectiveScale;
			innerHeight = geomBounds.Height * effectiveScale;
		}
		else if (Size.HasValue)
		{
			innerWidth = Math.Max(0, Size.Value.Width - Padding.Left - Padding.Right);
			innerHeight = Math.Max(0, Size.Value.Height - Padding.Top - Padding.Bottom);
			effectiveScale = Scale > 0 ? Scale : 1.0;
			if (Scale <= 0 && !geomBounds.IsEmpty && innerWidth > 0 && innerHeight > 0)
			{
				effectiveScale = Math.Min(innerWidth / geomBounds.Width, innerHeight / geomBounds.Height);
			}
		}
		else if (Scale <= 0 && !geomBounds.IsEmpty && (context.HasFiniteAvailableWidth || context.HasFiniteAvailableHeight))
		{
			// Auto-fit to whatever container we're being resolved into. This is the
			// "drop me on a Page and figure it out" path. Containers may constrain only
			// one axis (a vertical Stack provides width but unbounded height) — fit to
			// whichever axes are real instead of inventing a budget for the other.
			var availW = context.HasFiniteAvailableWidth
				? Math.Max(0, context.AvailableWidth - Padding.Left - Padding.Right)
				: 0;
			var availH = context.HasFiniteAvailableHeight
				? Math.Max(0, context.AvailableHeight - Padding.Top - Padding.Bottom)
				: 0;
			if (availW > 0 && availH > 0)
				effectiveScale = Math.Min(availW / geomBounds.Width, availH / geomBounds.Height);
			else if (availW > 0)
				effectiveScale = availW / geomBounds.Width;
			else if (availH > 0)
				effectiveScale = availH / geomBounds.Height;
			else
				effectiveScale = 1.0;
			innerWidth = geomBounds.Width * effectiveScale;
			innerHeight = geomBounds.Height * effectiveScale;
		}
		else if (geomBounds.IsEmpty)
		{
			innerWidth = 0;
			innerHeight = 0;
			effectiveScale = Scale > 0 ? Scale : 1.0;
		}
		else
		{
			effectiveScale = Scale > 0 ? Scale : 1.0;
			innerWidth = geomBounds.Width * effectiveScale;
			innerHeight = geomBounds.Height * effectiveScale;
		}

		var outerWidth = innerWidth + Padding.Left + Padding.Right;
		var outerHeight = innerHeight + Padding.Top + Padding.Bottom;

		// Explicit Caption wins; otherwise auto-label the inferred scale when asked.
		var effectiveCaption = !string.IsNullOrEmpty(Caption)
			? Caption
			: AutoScaleCaption && effectiveScale > 0 && !geomBounds.IsEmpty
				? FormatScaleLabel(effectiveScale)
				: null;

		// Caption sits below the frame's bottom edge, so the resolved group's bounds extend
		// downward from Origin.Y by (caption gap + caption height).
		var captionMetrics = string.IsNullOrEmpty(effectiveCaption)
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
			// One rule: geometry coordinates scale, styles do not. Stroke widths, dash
			// patterns, font sizes, and text background padding are all paper-space mm —
			// what the user authors is what shows up on paper. The group transform below
			// uniformly scales every coordinate, so we pre-multiply every paper-space style
			// length by 1/effectiveScale to cancel it out.
			var geometryToWrap = effectiveScale > 0 && Math.Abs(effectiveScale - 1.0) > 1e-12
				? CounterScalePaperSpaceStyles(resolvedGeometry, 1.0 / effectiveScale)
				: resolvedGeometry;

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
				Children = new[] { geometryToWrap },
			});
		}

		if (captionMetrics.Height > 0)
		{
			// Place caption baseline below the frame's bottom by (gap + ascent).
			var baseline = Origin.Y - CaptionGap - captionMetrics.Ascent;
			children.Add(new TextElement
			{
				Text = effectiveCaption,
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
			// Record the scale this view actually rendered at so a title block's {scale} token
			// can be auto-filled. Only stamp when geometry was drawn at a meaningful scale.
			Metadata = (!geomBounds.IsEmpty && effectiveScale > 0)
				? WithScale(Metadata, effectiveScale)
				: Metadata,
			Children = children,
			BoundsOverride = new BoundingBox(minX, minY, maxX, maxY),
		};
	}

	private static IReadOnlyDictionary<string, string> WithScale(IReadOnlyDictionary<string, string> existing, double scale)
	{
		var map = existing != null
			? new Dictionary<string, string>(existing.Count + 1)
			: new Dictionary<string, string>(1);
		if (existing != null)
			foreach (var kv in existing) map[kv.Key] = kv.Value;
		map[ScaleMetadataKey] = scale.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
		return map;
	}

	private static DrawElement CounterScalePaperSpaceStyles(DrawElement element, double styleScale)
	{
		switch (element)
		{
			case TextElement text when text.Style != null:
				return new TextElement
				{
					Id = text.Id,
					CssClass = text.CssClass,
					Metadata = text.Metadata,
					Text = text.Text,
					Position = text.Position,
					Style = ScaleTextStyle(text.Style, styleScale),
					RotationDegrees = text.RotationDegrees,
					Hyperlink = text.Hyperlink,
					Background = text.Background,
					BackgroundPadding = text.BackgroundPadding * styleScale,
					BackgroundCornerRadius = text.BackgroundCornerRadius * styleScale,
					MeasuredBounds = null,
				};
			case PathElement path when path.Stroke != null:
				return new PathElement
				{
					Id = path.Id,
					CssClass = path.CssClass,
					Metadata = path.Metadata,
					Path = path.Path,
					Stroke = ScaleStroke(path.Stroke, styleScale),
					Fill = path.Fill,
				};
			case DimensionElement dim:
				// TextSize, StrokeWidth, ArrowSize, and the *Factor fields all live in
				// paper-space mm (or as multiples of TextSize). Counter-scale the absolute
				// fields so labels, extension lines, and arrows stay constant on paper
				// regardless of the view's scale. Geometric inputs (A, B, Vertex, Offset)
				// are world coords and ride the group transform.
				return new DimensionElement
				{
					Id = dim.Id,
					CssClass = dim.CssClass,
					Metadata = dim.Metadata,
					Kind = dim.Kind,
					A = dim.A,
					B = dim.B,
					Vertex = dim.Vertex,
					Offset = dim.Offset,
					Label = dim.Label,
					Style = ScaleDimensionStyle(dim.Style, styleScale),
				};
			case LeaderElement leader:
				return new LeaderElement
				{
					Id = leader.Id,
					CssClass = leader.CssClass,
					Metadata = leader.Metadata,
					Points = leader.Points,
					Text = leader.Text,
					TextStyle = leader.TextStyle != null ? ScaleTextStyle(leader.TextStyle, styleScale) : leader.TextStyle,
					Stroke = leader.Stroke != null ? ScaleStroke(leader.Stroke, styleScale) : leader.Stroke,
					Head = leader.Head,
					HeadSize = leader.HeadSize * styleScale,
				};
			case GroupElement group:
				var rewritten = new List<DrawElement>(group.Children.Count);
				var changed = false;
				foreach (var child in group.Children)
				{
					var next = CounterScalePaperSpaceStyles(child, styleScale);
					if (!ReferenceEquals(next, child)) changed = true;
					rewritten.Add(next);
				}
				if (!changed) return group;
				return new GroupElement
				{
					Id = group.Id,
					CssClass = group.CssClass,
					Metadata = group.Metadata,
					Transform = group.Transform,
					BoundsOverride = group.BoundsOverride,
					PreviewOnly = group.PreviewOnly,
					Children = rewritten,
				};
			default:
				return element;
		}
	}

	private static Stroke ScaleStroke(Stroke stroke, double styleScale)
	{
		double[] dashes = null;
		if (stroke.DashArray != null && stroke.DashArray.Count > 0)
		{
			dashes = new double[stroke.DashArray.Count];
			for (var i = 0; i < stroke.DashArray.Count; i++) dashes[i] = stroke.DashArray[i] * styleScale;
		}
		return new Stroke
		{
			Color = stroke.Color,
			Width = stroke.Width * styleScale,
			Opacity = stroke.Opacity,
			Cap = stroke.Cap,
			Join = stroke.Join,
			MiterLimit = stroke.MiterLimit,
			DashArray = dashes,
			DashOffset = stroke.DashOffset * styleScale,
		};
	}

	private static TextStyle ScaleTextStyle(TextStyle style, double styleScale)
	{
		return new TextStyle
		{
			FontFamily = style.FontFamily,
			FontSize = style.FontSize * styleScale,
			Weight = style.Weight,
			Style = style.Style,
			Decoration = style.Decoration,
			Color = style.Color,
			HorizontalAnchor = style.HorizontalAnchor,
			VerticalAnchor = style.VerticalAnchor,
			LineHeight = style.LineHeight,
			LetterSpacing = style.LetterSpacing * styleScale,
		};
	}

	private static DimensionStyle ScaleDimensionStyle(DimensionStyle style, double styleScale)
	{
		if (style == null) return null;
		return new DimensionStyle
		{
			TextSize = style.TextSize * styleScale,
			StrokeWidth = style.StrokeWidth * styleScale,
			Color = style.Color,
			FontFamily = style.FontFamily,
			ExtensionGapFactor = style.ExtensionGapFactor,
			ExtensionOvershootFactor = style.ExtensionOvershootFactor,
			ExtensionLengthFactor = style.ExtensionLengthFactor,
			TextLiftFactor = style.TextLiftFactor,
			TextSidePaddingFactor = style.TextSidePaddingFactor,
			TickKind = style.TickKind,
			TextPlacement = style.TextPlacement,
			AutoFlipArrows = style.AutoFlipArrows,
			ArrowSize = style.ArrowSize * styleScale,
			ArrowSizeFactor = style.ArrowSizeFactor,
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
