using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Model.Drawings;

// A scaled view of geometry (curves, surfaces, dimensions, etc.) with an optional bordered
// frame and caption. Wraps the geometry in a Group whose transform translates to Origin,
// fits it to the viewport, and scales it, so the geometry's bounds land inside the requested
// viewport. Overflow is never clipped.
//
// Sizing, resolved in order: Length (pin longest side to N mm, aspect ratio follows), Size
// (occupy that rect, Scale <= 0 means fit-to-rect), context auto-fit (drop-on-a-Page path),
// natural size at Scale (default 1.0).
public sealed class DrawingView : LayoutElement
{
	public const string ScaleMetadataKey = "selva:scale";

	public DrawElement Geometry { get; init; }

	// 1.0 = full size in mm, 0.2 = 1:5, 2.0 = 2:1. Default 0 means auto-fit to the layout
	// context (or 1.0 if no context is available).
	public double Scale { get; init; } = 0.0;

	// Fixed viewport size. Null means fit to the scaled geometry + padding.
	public BoundingBox? Size { get; init; }

	// Pin the geometry's longest side (inner rect, post-padding) to this length in mm; the
	// other side follows the aspect ratio. Wins over Scale; ignored if Size is also set.
	public double? Length { get; init; }

	public Stroke Border { get; init; }
	public Fill Background { get; init; }
	public Margins Padding { get; init; } = Margins.Uniform(2);

	// Bottom-left of the view's outer rect, world coords.
	public Point2D Origin { get; init; } = Point2D.Zero;

	public string Caption { get; init; }

	// If true and Caption is unset, auto-labels the resolved scale as "SCALE 1:N". Ignored
	// when Caption is set.
	public bool AutoScaleCaption { get; init; }
	public TextStyle CaptionStyle { get; init; } = new TextStyle { FontSize = 2.5 };
	public double CaptionGap { get; init; } = 1.5;

	public override DrawElement Resolve(LayoutContext context)
	{
		// Flatten the whole geometry subtree, not just a LayoutElement sitting at its root.
		// Counter-scaling below rewrites primitives; an unresolved Frame/Stack/Grid one level
		// down (inside a GroupElement) would fall through its `default:` arm untouched and only
		// expand later in LayoutPass, after the styles it contains were supposed to be scaled.
		// The error is 1/Scale and unbounded: a 0.7 mm border printed at 0.07 mm at 1:10.
		//
		// Resolving here also settles the second half of the problem: the subtree is laid out
		// against its own unconstrained context rather than the outer page's, which is correct:
		// view geometry is model space, and the page rect is not its budget.
		var resolvedGeometry = LayoutPass.Resolve(Geometry, new LayoutContext(BoundingBox.Empty));

		// Scale from the geometry's own extent, not from bounds inflated by half the stroke
		// width. Line weight is a paper-space style that gets counter-scaled out anyway, so
		// letting it into the measurement made the drawing scale depend on it: a 20 mm square
		// with Length=20 resolved to 1:0.952 at a 1.0 mm weight, so the "20 mm" edge measured
		// 19.05 mm and two views of the same geometry at different weights would not align.
		var geomBounds = GeometryExtent(resolvedGeometry);

		// The caption hangs below the frame and is part of what the view occupies, so its cost
		// has to come out of the budget before the geometry is fitted, not stapled on after.
		// Adding it afterwards pushed an auto-fit view 4.5 mm past the content rect and straight
		// into the footer, and made an explicit `Size` of 60x40 resolve to 60x44.5.
		var captionReserve = CaptionReserve();

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
			var (padX, padY) = ClampPadding(Size.Value.Width, Size.Value.Height - captionReserve);
			innerWidth = Math.Max(0, Size.Value.Width - padX);
			innerHeight = Math.Max(0, Size.Value.Height - captionReserve - padY);
			effectiveScale = Scale > 0 ? Scale : 1.0;
			if (Scale <= 0 && !geomBounds.IsEmpty && innerWidth > 0 && innerHeight > 0)
			{
				effectiveScale = FitScale(innerWidth, innerHeight, geomBounds);
			}
		}
		else if (Scale <= 0 && !geomBounds.IsEmpty && (context.HasFiniteAvailableWidth || context.HasFiniteAvailableHeight))
		{
			// Auto-fit into whatever container we're resolved into. A container may constrain
			// only one axis (a vertical Stack gives width but unbounded height), so fit to
			// whichever axes are real rather than inventing a budget for the rest.
			//
			// A spent axis (budget 0) is still constrained, not free to size: collapsing both
			// to 0 dropped a spent axis out of the fit and let the view scale off the sheet (a
			// horizontal Stack once produced a 3789 mm page). Only genuinely unconstrained axes
			// are excluded from the fit.
			// Padding and the caption come out of the container's budget before the fit, and
			// padding is clamped so it can't exceed the room it sits in.
			var (availPadX, availPadY) = ClampPadding(
				context.HasFiniteAvailableWidth ? context.AvailableWidth : double.PositiveInfinity,
				context.HasFiniteAvailableHeight ? context.AvailableHeight - captionReserve : double.PositiveInfinity);
			double? availW = context.HasFiniteAvailableWidth
				? Math.Max(0, context.AvailableWidth - availPadX)
				: null;
			double? availH = context.HasFiniteAvailableHeight
				? Math.Max(0, context.AvailableHeight - captionReserve - availPadY)
				: null;
			if (availW.HasValue && availH.HasValue)
				effectiveScale = FitScale(availW.Value, availH.Value, geomBounds);
			else if (availW.HasValue)
				effectiveScale = AxisScale(availW.Value, geomBounds.Width);
			else if (availH.HasValue)
				effectiveScale = AxisScale(availH.Value, geomBounds.Height);
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

		// Re-derive the padding actually used for the branch we took above (Size vs. context
		// budget vs. unbounded), since each clamps against a different box.
		var (appliedPadX, appliedPadY) = Size.HasValue
			? ClampPadding(Size.Value.Width, Size.Value.Height - captionReserve)
			: ClampPadding(
				context.HasFiniteAvailableWidth ? context.AvailableWidth : double.PositiveInfinity,
				context.HasFiniteAvailableHeight ? context.AvailableHeight - captionReserve : double.PositiveInfinity);

		var outerWidth = innerWidth + appliedPadX;
		var outerHeight = innerHeight + appliedPadY;

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
			// patterns, font sizes, and text background padding are all paper-space mm:
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
			// DocumentLayoutPass reads this off the resolved group to auto-fill a title block's
			// {scale} token. Only stamped when geometry was drawn at a meaningful scale.
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
			// A hatched surface often has no stroke at all, so gating this on Stroke alone left
			// its pattern to ride the view transform unscaled.
			case PathElement path when path.Stroke != null || NeedsPatternScaling(path.Fill):
				return new PathElement
				{
					Id = path.Id,
					CssClass = path.CssClass,
					Metadata = path.Metadata,
					Path = path.Path,
					Stroke = path.Stroke != null ? ScaleStroke(path.Stroke, styleScale) : null,
					Fill = ScaleFill(path.Fill, styleScale),
				};
			case HatchElement hatch:
				// Spacing and LineStyle are paper-space for the same reason Fill.PatternScale
				// is: poché spacing is specified on the sheet. Boundary is world geometry and
				// rides the transform.
				return new HatchElement
				{
					Id = hatch.Id,
					CssClass = hatch.CssClass,
					Metadata = hatch.Metadata,
					Boundary = hatch.Boundary,
					Pattern = hatch.Pattern,
					Spacing = hatch.Spacing * styleScale,
					AngleDegrees = hatch.AngleDegrees,
					LineStyle = hatch.LineStyle != null ? ScaleStroke(hatch.LineStyle, styleScale) : null,
					BackgroundColor = hatch.BackgroundColor,
					FillRule = hatch.FillRule,
				};
			case DimensionElement dim:
				// TextSize, StrokeWidth, ArrowSize, Offset, and the *Factor fields all live in
				// paper-space mm (or as multiples of TextSize). Counter-scale the absolute
				// fields so labels, extension lines, arrows, and the dimension line's standoff
				// stay constant on paper regardless of the view's scale: a dimension is an
				// annotation, so it is sized for the reader's eye, not for the model. Only the
				// measured points (A, B, Vertex) are world coords that ride the group
				// transform; the value the dimension reports still comes from those.
				//
				// Offset must be counter-scaled with the rest: the renderer derives the
				// extension-line gap and overshoot from TextSize and then subtracts them from
				// Offset, so leaving Offset in world units puts the two sides of that
				// subtraction 1/Scale apart: at 1:50 a 5 mm offset landed 0.1 mm off the
				// geometry and the extension lines clamped away entirely.
				return new DimensionElement
				{
					Id = dim.Id,
					CssClass = dim.CssClass,
					Metadata = dim.Metadata,
					Kind = dim.Kind,
					A = dim.A,
					B = dim.B,
					Vertex = dim.Vertex,
					Offset = dim.Offset * styleScale,
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
			case TextBlockElement textBlock:
				// Style is paper-space like every other text style; Box is world geometry and
				// rides the transform. Not reachable from Grasshopper today (TokenResolver is
				// the only construction site), handled so the invariant holds by element type
				// rather than by which elements happen to be constructible.
				return new TextBlockElement
				{
					Id = textBlock.Id,
					CssClass = textBlock.CssClass,
					Metadata = textBlock.Metadata,
					Text = textBlock.Text,
					Box = textBlock.Box,
					Style = textBlock.Style != null ? ScaleTextStyle(textBlock.Style, styleScale) : textBlock.Style,
				};
			case SymbolElement symbol when symbol.Definition != null:
				// A symbol's children are paper-space annotation in exactly the sense text and
				// dimensions are: north arrows, section marks and weld symbols are drawn at a
				// fixed size on the sheet, not at model scale. Without this arm they ride the
				// view transform raw and a 0.7 mm symbol stroke prints at 0.07 mm at 1:10.
				//
				// The Definition.Id must be qualified by the scale. Both renderers dedupe
				// definitions by Id (SVG <symbol>/<use>, PDF Form XObject), and the PDF
				// collector throws outright when one Id maps to two different definitions,
				// which is precisely what two views of the same symbol at different scales
				// would produce once the children differ.
				var scaledChildren = new List<DrawElement>(symbol.Definition.Children.Count);
				var symbolChanged = false;
				foreach (var child in symbol.Definition.Children)
				{
					var next = CounterScalePaperSpaceStyles(child, styleScale);
					if (!ReferenceEquals(next, child)) symbolChanged = true;
					scaledChildren.Add(next);
				}
				if (!symbolChanged) return symbol;
				return new SymbolElement
				{
					Id = symbol.Id,
					CssClass = symbol.CssClass,
					Metadata = symbol.Metadata,
					Position = symbol.Position,
					Transform = symbol.Transform,
					Definition = new SymbolDefinition
					{
						Id = ScaleQualifiedId(symbol.Definition.Id, styleScale),
						ViewBox = symbol.Definition.ViewBox,
						Children = scaledChildren,
					},
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

	// Symbol definitions are deduped by Id across a whole page, so a definition whose children
	// have been counter-scaled for one view must not answer to the same Id as the unscaled
	// original or another view's differently-scaled copy. Null/empty Ids are left alone: both
	// renderers treat those as "inline me, don't cache me".
	private static string ScaleQualifiedId(string id, double styleScale)
	{
		if (string.IsNullOrEmpty(id)) return id;
		return $"{id}@{styleScale.ToString("R", System.Globalization.CultureInfo.InvariantCulture)}";
	}

	private static bool NeedsPatternScaling(Fill fill) =>
		fill != null && fill.Pattern != HatchPattern.None;

	// A hatch tile is a paper-space measurement in the same sense as text height: drafting
	// standards specify poché spacing on the printed sheet, and a pattern that rides the view
	// transform collapses into a solid smear as the scale drops (at 1:50 the 4 mm tile landed
	// at 0.08 mm, tighter than the line weight drawing it).
	private static Fill ScaleFill(Fill fill, double styleScale)
	{
		if (!NeedsPatternScaling(fill)) return fill;
		return new Fill
		{
			Color = fill.Color,
			Opacity = fill.Opacity,
			Rule = fill.Rule,
			Pattern = fill.Pattern,
			PatternScale = fill.PatternScale * styleScale,
			PatternAngle = fill.PatternAngle,
			PatternSpacingMm = fill.PatternSpacingMm * styleScale,
			// Same visibility floor as ScaleStrokeWidth: a hatch tile's linework disappears on
			// an enlargement view for exactly the same reason a path's outline does.
			PatternLineWidthMm = ScaleStrokeWidth(fill.PatternLineWidthMm, styleScale),
		};
	}

	// Counter-scale a stroke width without letting an authored-visible line become invisible.
	//
	// `Stroke.MinVisibleWidthMm` is a device threshold about the printed sheet, but it is tested
	// by the renderers against the counter-scaled LOCAL width. On an enlargement view the
	// counter-scale is a fraction (1/20 at 20:1), so a perfectly ordinary paper weight lands
	// under the threshold and both renderers skip the stroke: at 50:1 every standard weight
	// (0.13 / 0.25 / 0.5 mm) vanished and a detail view exported as a blank page.
	//
	// The renderers can't judge this: they never see the view scale, so the decision belongs
	// here, where the authored width is still known. A stroke the author made visible stays
	// visible; a stroke authored at or below the threshold (including the deliberate 0 = "no
	// stroke") is left to scale to nothing as before.
	private static double ScaleStrokeWidth(double authoredWidth, double styleScale)
	{
		var scaled = authoredWidth * styleScale;
		if (!Stroke.IsVisibleWidth(authoredWidth)) return scaled;
		return Math.Max(scaled, Stroke.MinVisibleWidthMm * (1.0 + 1e-9));
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
			// Zero stays zero through the multiply, which is what we want: a suppressed stroke
			// is suppressed at every view scale.
			Width = ScaleStrokeWidth(stroke.Width, styleScale),
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

	// Bounds of the geometry itself, with PathElement's stroke inflation unwound. PathElement
	// is the only element that pads its bounds by the drawn line width; DimensionElement and
	// LeaderElement also inflate, but they pad for arrowheads and label text, which is real
	// extent the view has to make room for.
	private static BoundingBox GeometryExtent(DrawElement element)
	{
		switch (element)
		{
			case null:
				return BoundingBox.Empty;
			case PathElement path:
				return path.Path.ComputeBounds();
			case GroupElement group:
				var union = BoundingBox.Empty;
				foreach (var child in group.Children)
				{
					var b = GeometryExtent(child);
					if (!b.IsEmpty) union = union.Union(b);
				}
				if (union.IsEmpty) return union;
				return group.Transform.IsIdentity ? union : TransformBounds(union, group.Transform);
			default:
				return element.ComputeBounds();
		}
	}

	// Axis-aligned bounds of a box after a transform: map all four corners, since a rotation
	// makes the transformed min/max corners insufficient on their own.
	private static BoundingBox TransformBounds(BoundingBox box, Transform t)
	{
		var result = BoundingBox.Empty;
		result = result.Union(t.Apply(new Point2D(box.MinX, box.MinY)));
		result = result.Union(t.Apply(new Point2D(box.MaxX, box.MinY)));
		result = result.Union(t.Apply(new Point2D(box.MaxX, box.MaxY)));
		result = result.Union(t.Apply(new Point2D(box.MinX, box.MaxY)));
		return result;
	}

	// Vertical room the caption will need, including its gap, reserved out of the budget before
	// the geometry is fitted. Depends only on CaptionStyle and whether a caption will exist at
	// all, both of which are known before the scale is resolved. The AutoScaleCaption case can't
	// know the label's *text* yet, but every label is one line at the same style, so the height
	// is the same either way.
	private double CaptionReserve()
	{
		var willCaption = !string.IsNullOrEmpty(Caption) || AutoScaleCaption;
		if (!willCaption) return 0;
		var metrics = ComputeCaptionMetrics();
		return metrics.Height > 0 ? CaptionGap + metrics.Height : 0;
	}

	// Padding clamped to the box it sits inside, returned as per-axis totals. Padding is a
	// margin taken out of a box, so it can never be larger than the box: left unclamped, a
	// padding wider than its own view grew the view instead of shrinking its content.
	// Proportional so an asymmetric padding keeps its ratio as it shrinks.
	private (double X, double Y) ClampPadding(double availableWidth, double availableHeight)
	{
		var padX = Padding.Left + Padding.Right;
		var padY = Padding.Top + Padding.Bottom;
		if (padX > 0 && !double.IsInfinity(availableWidth) && padX > availableWidth)
			padX = Math.Max(0, availableWidth);
		if (padY > 0 && !double.IsInfinity(availableHeight) && padY > availableHeight)
			padY = Math.Max(0, availableHeight);
		return (padX, padY);
	}

	private (double Height, double Ascent) ComputeCaptionMetrics()
	{
		var probe = Fonts.FontMetrics.Measure(string.Empty, CaptionStyle ?? new TextStyle());
		var lineHeight = probe.Ascent + Math.Abs(probe.Descent) + probe.LineGap;
		return (lineHeight, probe.Ascent);
	}

	// Fit geometry into an available box. A geometry that is flat on one axis (a horizontal
	// line, a collapsed path) has no ratio to satisfy on that axis, so it is excluded from the
	// Math.Min rather than contributing a division by zero. When both axes are flat there is
	// no meaningful scale at all and we fall back to 1:1: the alternative is +Infinity, which
	// propagates into the group transform as NaN and emits `NaN NaN NaN NaN NaN NaN cm` into
	// the PDF content stream.
	private static double FitScale(double availableWidth, double availableHeight, BoundingBox geomBounds)
	{
		var byWidth = geomBounds.Width > 0 ? availableWidth / geomBounds.Width : double.PositiveInfinity;
		var byHeight = geomBounds.Height > 0 ? availableHeight / geomBounds.Height : double.PositiveInfinity;
		return Usable(Math.Min(byWidth, byHeight));
	}

	private static double AxisScale(double available, double extent) =>
		Usable(extent > 0 ? available / extent : double.PositiveInfinity);

	// A non-finite ratio means the axis had no extent to divide by, so there was never a real
	// constraint: fall back to 1:1. A finite zero is different: the container genuinely has no
	// room, and honouring it is what keeps an exhausted budget from scaling the view off the
	// sheet. Clamped at zero so a negative budget can't mirror the geometry.
	private static double Usable(double scale) =>
		double.IsNaN(scale) || double.IsInfinity(scale) ? 1.0 : Math.Max(0, scale);

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
