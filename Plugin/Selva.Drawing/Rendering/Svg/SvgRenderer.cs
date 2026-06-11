using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Rendering.Svg;

// Walks a Document and emits SVG. Phase 2 target: byte-identical output to the legacy
// SvgDocument.Build for the equivalent inputs (curves -> PathElement, surfaces -> filled
// PathElement, text -> TextElement, dimensions -> DimensionElement). Multi-page docs
// render only their first page here; multi-page output is Phase 6.
public sealed class SvgRenderer : IRenderer<string>, IElementVisitor
{
	private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

	private readonly SvgRenderOptions _options;
	private StringBuilder _sb;
	private bool _hasDimensions;
	// Unique arrow sizes collected per page: key = rounded mm value, value = marker id.
	private Dictionary<double, string> _dimArrowMarkers;
	// Phase 10a: collected once per page so <symbol> defs and <use> refs both see the
	// same set. Key is SymbolDefinition.Id; null/empty Ids fall through to inline
	// expansion (same as pre-Phase-10 behaviour).
	private Dictionary<string, SymbolDefinition> _symbolDefs;
	// Hatch patterns collected per page: key = stable pattern id string, value = Fill snapshot.
	private Dictionary<string, Fill> _hatchPatternDefs;
	private int _hatchClipCounter;

	public SvgRenderer() : this(new SvgRenderOptions()) { }
	public SvgRenderer(SvgRenderOptions options)
	{
		_options = options ?? new SvgRenderOptions();
	}

	public string Render(Document document)
	{
		if (document == null) throw new ArgumentNullException(nameof(document));
		if (document.Pages.Count == 0) return "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'></svg>";
		return RenderPage(document, document.Pages[0]);
	}

	// Phase 6: per-page render. SVG has no native multi-page concept, so the convention here
	// is "one file per page" (Decision #3 in the architecture plan). Callers wanting to
	// persist multiple pages write each entry to its own file. The legacy single-page
	// Render(...) stays put for back-compat.
	public IReadOnlyList<string> RenderAll(Document document)
	{
		if (document == null) throw new ArgumentNullException(nameof(document));
		if (document.Pages.Count == 0) return new[] { Render(document) };
		var pages = new string[document.Pages.Count];
		for (var i = 0; i < document.Pages.Count; i++)
			pages[i] = RenderPage(document, document.Pages[i]);
		return pages;
	}

	public string RenderPage(Document document, Page page)
	{
		if (page == null) throw new ArgumentNullException(nameof(page));

		// Phase 7: resolve any LayoutElements (Stack/Grid/Frame/TextFlow/Table) into
		// primitive elements before walking the visitor. The renderer only ever sees
		// PathElement / TextElement / ... after this — keeps the visitor surface narrow.
		page = LayoutPass.ResolvePage(page);

		_dimArrowMarkers = CollectDimArrowMarkers(page.Content);
		_hasDimensions = _dimArrowMarkers.Count > 0 || ContainsDimensions(page.Content);
		_symbolDefs = CollectSymbolDefinitions(page.Content);
		_hatchPatternDefs = CollectHatchPatterns(page.Content);

		var bounds = MeasureForViewBox(page.Content);
		if (bounds.IsEmpty || !_options.AutoFitToContent && !HasPaperSize(page))
			return "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'></svg>";

		double minX, minY, width, height;
		if (_options.AutoFitToContent)
		{
			// Legacy SVG viewBox lives in post-Y-flip coordinates: world Y range becomes
			// -maxY..-minY. The Y-flip group inside reverts that for content drawing.
			minX = bounds.MinX - _options.Padding;
			minY = -bounds.MaxY - _options.Padding;
			width = bounds.Width + _options.Padding * 2;
			height = bounds.Height + _options.Padding * 2;
		}
		else
		{
			// Paper-size mode: viewBox covers the whole page, origin at top-left in SVG-space
			// (still y-flipped before content draws).
			minX = 0;
			minY = -page.Size.HeightMm;
			width = page.Size.WidthMm;
			height = page.Size.HeightMm;
		}

		_sb = new StringBuilder();
		_sb.Append("<?xml version='1.0' encoding='UTF-8'?>\n");
		_sb.Append("<svg xmlns='http://www.w3.org/2000/svg' version='1.1'");
		_sb.Append(" width='").Append(F(width)).Append('\'');
		_sb.Append(" height='").Append(F(height)).Append('\'');
		_sb.Append(" viewBox='")
			.Append(F(minX)).Append(' ')
			.Append(F(minY)).Append(' ')
			.Append(F(width)).Append(' ')
			.Append(F(height)).Append('\'');
		_sb.Append(">\n");

		var title = ResolveTitle(document, page);
		if (!string.IsNullOrEmpty(title))
			_sb.Append("<title>").Append(Escape(title)).Append("</title>\n");

		AppendDefs();

		if (!string.IsNullOrEmpty(_options.BackgroundColor))
			_sb.Append("<rect width='100%' height='100%' fill='")
				.Append(Escape(_options.BackgroundColor)).Append("' />\n");

		// Single root Y-flip — everything else uses Rhino-world coordinates.
		// font-family is set here so all <text> descendants inherit it. The stack may
		// contain "Quoted Names" — encode them as &quot; so the single-quoted attr stays
		// valid.
		_sb.Append("<g transform='matrix(1 0 0 -1 0 0)' font-family='")
			.Append(Escape(_options.FontFamily ?? SvgRenderOptions.DefaultFontFamily).Replace("\"", "&quot;"))
			.Append("'>\n");

		if (page.Content != null) page.Content.Accept(this);

		_sb.Append("</g>\n");
		_sb.Append("</svg>\n");

		var result = _sb.ToString();
		_sb = null;
		return result;
	}

	private string ResolveTitle(Document document, Page page)
	{
		if (_options.Title != null) return _options.Title;
		if (!string.IsNullOrEmpty(page.Title)) return page.Title;
		if (!string.IsNullOrEmpty(document.Metadata?.Title)) return document.Metadata.Title;
		return "Drawing";
	}

	private static bool HasPaperSize(Page page) => page.Size.WidthMm > 0 && page.Size.HeightMm > 0;

	// Measures bounds the same way the legacy SvgDocument did — raw geometry bounds for
	// paths/text, precise endpoint+midpoint sampling for dimensions. Distinct from
	// DrawElement.ComputeBounds, which conservatively inflates by stroke and approximates
	// dim arrows via padding; that's the right answer for layout but produces a viewBox
	// that doesn't byte-match the legacy output.
	private static BoundingBox MeasureForViewBox(DrawElement element)
	{
		var b = BoundingBox.Empty;
		Accumulate(element, ref b, Transform.Identity);
		return b;
	}

	private static void Accumulate(DrawElement element, ref BoundingBox bounds, Transform t)
	{
		if (element == null) return;
		switch (element)
		{
			case GroupElement g:
				var combined = g.Transform.IsIdentity ? t : t.Multiply(g.Transform);
				foreach (var c in g.Children) Accumulate(c, ref bounds, combined);
				break;
			case PathElement p:
				bounds = bounds.Union(TransformBox(p.Path.ComputeBounds(), t));
				break;
			case TextElement te:
				bounds = bounds.Union(TransformBox(te.ComputeBounds(), t));
				break;
			case TextBlockElement tb:
				bounds = bounds.Union(TransformBox(tb.Box, t));
				break;
			case DimensionElement d:
				bounds = bounds.Union(TransformBox(DimensionMeasure.Measure(d), t));
				break;
			case LeaderElement le:
				bounds = bounds.Union(TransformBox(le.ComputeBounds(), t));
				break;
			case SymbolElement s when s.Definition != null:
				var inner = BoundingBox.Empty;
				foreach (var c in s.Definition.Children) Accumulate(c, ref inner, Transform.Identity);
				if (!inner.IsEmpty)
				{
					var translated = new BoundingBox(
						inner.MinX + s.Position.X, inner.MinY + s.Position.Y,
						inner.MaxX + s.Position.X, inner.MaxY + s.Position.Y);
					var local = s.Transform.IsIdentity ? translated : TransformBox(translated, s.Transform);
					bounds = bounds.Union(TransformBox(local, t));
				}
				break;
			default:
				bounds = bounds.Union(TransformBox(element.ComputeBounds(), t));
				break;
		}
	}

	private static BoundingBox TransformBox(BoundingBox b, Transform t)
	{
		if (t.IsIdentity || b.IsEmpty) return b;
		var p1 = t.Apply(new Point2D(b.MinX, b.MinY));
		var p2 = t.Apply(new Point2D(b.MaxX, b.MinY));
		var p3 = t.Apply(new Point2D(b.MaxX, b.MaxY));
		var p4 = t.Apply(new Point2D(b.MinX, b.MaxY));
		return BoundingBox.FromPoint(p1).Union(p2).Union(p3).Union(p4);
	}

	private static bool ContainsDimensions(DrawElement element)
	{
		if (element == null) return false;
		if (element is DimensionElement) return true;
		if (element is GroupElement g)
		{
			foreach (var c in g.Children) if (ContainsDimensions(c)) return true;
		}
		return false;
	}

	private static Dictionary<double, string> CollectDimArrowMarkers(DrawElement element)
	{
		var sizes = new Dictionary<double, string>();
		CollectDimArrowSizes(element, sizes);
		return sizes;
	}

	private static void CollectDimArrowSizes(DrawElement element, Dictionary<double, string> sizes)
	{
		if (element == null) return;
		if (element is DimensionElement dim)
		{
			var style = dim.Style ?? new DimensionStyle();
			if (style.TickKind == DimensionTickKind.Arrow)
				RegisterArrowSize(style.ResolvedArrowSize(), sizes);
		}
		else if (element is LeaderElement leader && leader.Head == LeaderHead.Arrow)
		{
			RegisterArrowSize(leader.HeadSize, sizes);
		}
		else if (element is GroupElement g)
		{
			foreach (var c in g.Children) CollectDimArrowSizes(c, sizes);
		}
	}

	private static void RegisterArrowSize(double arrowSize, Dictionary<double, string> sizes)
	{
		// Round to 4 decimal places to avoid float noise creating duplicate markers.
		var key = Math.Round(arrowSize, 4);
		if (!sizes.ContainsKey(key))
			sizes[key] = "selva-dim-arrow-" + key.ToString("0.####", Inv).Replace(".", "_");
	}

	private string DimArrowMarkerId(DimensionStyle style)
	{
		var key = Math.Round(style.ResolvedArrowSize(), 4);
		return _dimArrowMarkers.TryGetValue(key, out var id) ? id : "selva-dim-arrow-fallback";
	}

	private string LeaderArrowMarkerId(LeaderElement leader)
	{
		var key = Math.Round(leader.HeadSize, 4);
		return _dimArrowMarkers.TryGetValue(key, out var id) ? id : "selva-dim-arrow-fallback";
	}

	private void AppendDefs()
	{
		var fonts = _options.EmbedFonts ? SvgFontResolver.LoadAll() : Array.Empty<SvgFontResolver.EmbeddedFont>();
		var hasSymbols = _symbolDefs != null && _symbolDefs.Count > 0;
		var hasHatches = _hatchPatternDefs != null && _hatchPatternDefs.Count > 0;
		var emitDefs = _hasDimensions || fonts.Count > 0 || hasSymbols || hasHatches;
		if (!emitDefs) return;

		_sb.Append("<defs>\n");

		if (_hasDimensions)
		{
			// One arrow marker per unique arrowSize (markerUnits=userSpaceOnUse so size
			// is in mm, independent of stroke-width). markerWidth/Height = arrowSize so
			// the triangle matches TextSize x ArrowSizeFactor exactly.
			foreach (var kvp in _dimArrowMarkers)
			{
				var sz = F(kvp.Key);
				_sb.Append("  <marker id='").Append(kvp.Value).Append("' viewBox='0 0 10 10' refX='10' refY='5'")
					.Append(" markerUnits='userSpaceOnUse'")
					.Append(" markerWidth='").Append(sz).Append("' markerHeight='").Append(sz).Append("'")
					.Append(" orient='auto-start-reverse'>\n");
				_sb.Append("    <path d='M 0 0 L 10 5 L 0 10 Z' fill='context-stroke' />\n");
				_sb.Append("  </marker>\n");
			}
			_sb.Append("  <marker id='selva-dim-tick' viewBox='-5 -5 10 10' refX='0' refY='0' markerWidth='10' markerHeight='10' orient='auto'>\n");
			_sb.Append("    <path d='M -3 3 L 3 -3' stroke='context-stroke' stroke-width='1' />\n");
			_sb.Append("  </marker>\n");
		}

		if (fonts.Count > 0)
		{
			_sb.Append("  <style>\n");
			foreach (var f in fonts)
			{
				_sb.Append("    @font-face { font-family: '").Append(f.Family)
					.Append("'; font-weight: ").Append(f.Weight)
					.Append("; font-style: ").Append(f.Style)
					.Append("; src: url('").Append(f.DataUri)
					.Append("') format('truetype'); }\n");
			}
			_sb.Append("  </style>\n");
		}

		if (hasSymbols) AppendSymbolDefs();
		if (hasHatches) AppendHatchPatternDefs();

		_sb.Append("</defs>\n");
	}

	private void AppendSymbolDefs()
	{
		// Emit each unique SymbolDefinition once. Children render through the visitor with
		// the standard Y-up world coords; a <use> instance later applies its own
		// translate/transform without disturbing the symbol's local coord system.
		foreach (var kvp in _symbolDefs)
		{
			var def = kvp.Value;
			_sb.Append("  <symbol id='").Append(Escape(def.Id)).Append('\'');
			if (def.ViewBox.HasValue && !def.ViewBox.Value.IsEmpty)
			{
				var vb = def.ViewBox.Value;
				_sb.Append(" viewBox='")
					.Append(F(vb.MinX)).Append(' ').Append(F(vb.MinY)).Append(' ')
					.Append(F(vb.Width)).Append(' ').Append(F(vb.Height)).Append('\'');
				_sb.Append(" overflow='visible'");
			}
			_sb.Append(">\n");

			// SVG <symbol> children are emitted top-down (no Y-flip wrapper inside the def)
			// so callers measure them in the same Y-up world space as the rest of the model.
			// The outer Y-flip on <g> still applies to the surrounding <use>.
			foreach (var child in def.Children) child?.Accept(this);

			_sb.Append("  </symbol>\n");
		}
	}

	private void AppendHatchPatternDefs()
	{
		foreach (var kvp in _hatchPatternDefs)
		{
			var id = kvp.Key;
			var fill = kvp.Value;
			var scale = fill.PatternScale > 0 ? fill.PatternScale : 1.0;
			var angle = fill.PatternAngle;
			var color = ColorValue(fill.Color);

			// Base tile sizes in mm — scale multiplied in.
			var tileSize = 4.0 * scale;
			var transform = angle != 0.0
				? $" patternTransform='rotate({F(angle)})'"
				: "";

			switch (fill.Pattern)
			{
				case HatchPattern.Lines:
					// Parallel diagonal lines at 45°.
					_sb.Append($"  <pattern id='{id}' x='0' y='0' width='{F(tileSize)}' height='{F(tileSize)}' patternUnits='userSpaceOnUse'{transform}>\n");
					_sb.Append($"    <line x1='0' y1='0' x2='{F(tileSize)}' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(-tileSize)}' y1='0' x2='0' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(tileSize)}' y1='0' x2='{F(tileSize * 2)}' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append("  </pattern>\n");
					break;

				case HatchPattern.CrossHatch:
					// Two sets of crossing diagonal lines.
					_sb.Append($"  <pattern id='{id}' x='0' y='0' width='{F(tileSize)}' height='{F(tileSize)}' patternUnits='userSpaceOnUse'{transform}>\n");
					_sb.Append($"    <line x1='0' y1='0' x2='{F(tileSize)}' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(-tileSize)}' y1='0' x2='0' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(tileSize)}' y1='0' x2='{F(tileSize * 2)}' y2='{F(tileSize)}' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='0' y1='{F(tileSize)}' x2='{F(tileSize)}' y2='0' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(-tileSize)}' y1='{F(tileSize)}' x2='0' y2='0' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append($"    <line x1='{F(tileSize)}' y1='{F(tileSize)}' x2='{F(tileSize * 2)}' y2='0' stroke='{color}' stroke-width='{F(0.3 * scale)}' />\n");
					_sb.Append("  </pattern>\n");
					break;

				case HatchPattern.Dots:
					// Small dots on a regular grid.
					var dotR = 0.4 * scale;
					var half = tileSize / 2;
					_sb.Append($"  <pattern id='{id}' x='0' y='0' width='{F(tileSize)}' height='{F(tileSize)}' patternUnits='userSpaceOnUse'{transform}>\n");
					_sb.Append($"    <circle cx='{F(half)}' cy='{F(half)}' r='{F(dotR)}' fill='{color}' />\n");
					_sb.Append("  </pattern>\n");
					break;

				case HatchPattern.Brick:
					// Staggered horizontal lines mimicking a brick coursing pattern.
					var brickH = tileSize;
					var brickW = tileSize * 2;
					var sw = 0.3 * scale;
					_sb.Append($"  <pattern id='{id}' x='0' y='0' width='{F(brickW)}' height='{F(brickH)}' patternUnits='userSpaceOnUse'{transform}>\n");
					// Full-width horizontal course lines
					_sb.Append($"    <line x1='0' y1='0' x2='{F(brickW)}' y2='0' stroke='{color}' stroke-width='{F(sw)}' />\n");
					_sb.Append($"    <line x1='0' y1='{F(brickH / 2)}' x2='{F(brickW)}' y2='{F(brickH / 2)}' stroke='{color}' stroke-width='{F(sw)}' />\n");
					// Vertical head joints — offset by half a brick width on alternating rows
					_sb.Append($"    <line x1='0' y1='0' x2='0' y2='{F(brickH / 2)}' stroke='{color}' stroke-width='{F(sw)}' />\n");
					_sb.Append($"    <line x1='{F(brickW)}' y1='0' x2='{F(brickW)}' y2='{F(brickH / 2)}' stroke='{color}' stroke-width='{F(sw)}' />\n");
					_sb.Append($"    <line x1='{F(brickW / 2)}' y1='{F(brickH / 2)}' x2='{F(brickW / 2)}' y2='{F(brickH)}' stroke='{color}' stroke-width='{F(sw)}' />\n");
					_sb.Append("  </pattern>\n");
					break;
			}
		}
	}

	// Walks the page element tree and collects every unique hatch Fill into a keyed dict.
	// Key encodes pattern + color + scale + angle so two fills that differ only in color
	// get distinct <pattern> elements.
	private static Dictionary<string, Fill> CollectHatchPatterns(DrawElement element)
	{
		var result = new Dictionary<string, Fill>(StringComparer.Ordinal);
		WalkHatches(element, result);
		return result;
	}

	private static void WalkHatches(DrawElement element, Dictionary<string, Fill> result)
	{
		if (element == null) return;
		if (element is PathElement path && path.Fill != null && path.Fill.Pattern != HatchPattern.None)
		{
			var key = HatchPatternId(path.Fill);
			if (!result.ContainsKey(key)) result[key] = path.Fill;
		}
		if (element is GroupElement group)
			foreach (var child in group.Children) WalkHatches(child, result);
	}

	internal static string HatchPatternId(Fill fill)
	{
		// Stable, attribute-safe id — no spaces, no special chars.
		var colorHex = fill.Color.Space == ColorSpace.Rgb
			? $"{(int)(fill.Color.R * 255):x2}{(int)(fill.Color.G * 255):x2}{(int)(fill.Color.B * 255):x2}"
			: fill.Color.GetHashCode().ToString("x8");
		var scaleStr = ((int)(fill.PatternScale * 100)).ToString();
		var angleStr = ((int)(fill.PatternAngle * 10)).ToString().Replace("-", "n");
		return $"selva-hatch-{fill.Pattern.ToString().ToLowerInvariant()}-{colorHex}-s{scaleStr}-a{angleStr}";
	}

	// Walks the page once and returns every reachable SymbolDefinition keyed by Id.
	// Definitions with null/empty Id are skipped — those fall back to inline expansion
	// in Visit(SymbolElement). Throws on Id collision with non-equal definitions, since
	// that's a user bug we'd rather surface loudly than silently dedupe wrong.
	private static Dictionary<string, SymbolDefinition> CollectSymbolDefinitions(DrawElement element)
	{
		var defs = new Dictionary<string, SymbolDefinition>(StringComparer.Ordinal);
		Walk(element, defs);
		return defs;
	}

	private static void Walk(DrawElement element, Dictionary<string, SymbolDefinition> defs)
	{
		if (element == null) return;
		switch (element)
		{
			case GroupElement g:
				foreach (var c in g.Children) Walk(c, defs);
				break;
			case SymbolElement s when s.Definition != null && !string.IsNullOrEmpty(s.Definition.Id):
				if (defs.TryGetValue(s.Definition.Id, out var existing))
				{
					if (!ReferenceEquals(existing, s.Definition))
						throw new InvalidOperationException(
							$"SymbolDefinition.Id '{s.Definition.Id}' is used by two different definitions.");
				}
				else
				{
					defs[s.Definition.Id] = s.Definition;
					// Symbols may nest other symbols.
					foreach (var c in s.Definition.Children) Walk(c, defs);
				}
				break;
		}
	}

	// ============================================================================
	// IElementVisitor
	// ============================================================================

	public void Visit(GroupElement element)
	{
		if (element == null) return;

		var hasTransform = !element.Transform.IsIdentity;
		if (hasTransform)
		{
			_sb.Append("  <g transform='matrix(")
				.Append(F(element.Transform.A)).Append(' ').Append(F(element.Transform.B)).Append(' ')
				.Append(F(element.Transform.C)).Append(' ').Append(F(element.Transform.D)).Append(' ')
				.Append(F(element.Transform.E)).Append(' ').Append(F(element.Transform.F)).Append(")'");
			AppendIdClass(element.Id, element.CssClass);
			AppendData(element.Metadata);
			_sb.Append(">\n");
		}

		foreach (var child in element.Children) child?.Accept(this);

		if (hasTransform) _sb.Append("  </g>\n");
	}

	public void Visit(PathElement element)
	{
		if (element == null) return;
		_sb.Append("  <path");
		AppendIdClass(element.Id, element.CssClass);
		_sb.Append(" d='");
		SvgPathBuilder.AppendTo(_sb, element.Path);
		_sb.Append('\'');

		// Legacy emitted fill-rule only on filled surfaces, not on stroked-only curves.
		if (element.Fill != null)
		{
			var fillRule = element.Fill.Rule;
			var hasMultipleSubpaths = HasMultipleMoveTos(element.Path);
			if (hasMultipleSubpaths || fillRule == FillRule.NonZero)
				_sb.Append(" fill-rule='").Append(fillRule == FillRule.NonZero ? "nonzero" : "evenodd").Append('\'');
		}

		AppendStyle(element.Stroke, element.Fill, defaultFillNone: true);
		AppendData(element.Metadata);
		_sb.Append(" />\n");
	}

	public void Visit(TextElement element)
	{
		if (element == null) return;
		var style = element.Style ?? new TextStyle();
		var hasLink = !string.IsNullOrEmpty(element.Hyperlink);
		var hasBackground = element.Background.HasValue;

		// Phase 9: clickable hyperlink wraps the text in an <a> element. SVG renderers in
		// browsers treat <a> as a generic clickable container; PDF/SVG export tools turn it
		// into a /Link annotation.
		if (hasLink)
		{
			_sb.Append("  <a href='").Append(Escape(element.Hyperlink)).Append("'>\n");
		}

		// Text is positioned in Rhino-world space; the root Y-flip would invert it,
		// so we counter-flip with scale(1,-1) and then apply the user rotation. When a
		// background is present we share that transform with the rect via a <g> wrapper
		// so the rect rotates with the glyphs.
		var transform = "translate(" + F(element.Position.X) + ' ' + F(element.Position.Y)
			+ ") scale(1 -1) rotate(" + F(-element.RotationDegrees) + ")";

		if (hasBackground)
			AppendTextBackgroundRect(element, style, transform);

		// Baseline placement via an explicit y offset (not dominant-baseline, whose support
		// varies across SVG viewers) so style.VerticalAnchor renders the same as in the PDF
		// exporter and the Rhino viewport.
		_sb.Append("  <text x='0' y='").Append(F(BaselineShift(style))).Append('\'');
		AppendIdClass(element.Id, element.CssClass);
		_sb.Append(" font-size='").Append(F(style.FontSize)).Append('\'');
		AppendFontAttributes(style);
		_sb.Append(" fill='").Append(ColorValue(style.Color)).Append('\'');
		_sb.Append(" text-anchor='").Append(AnchorToSvg(style.HorizontalAnchor)).Append('\'');
		_sb.Append(" transform='").Append(transform).Append('\'');
		AppendData(element.Metadata);
		_sb.Append('>').Append(Escape(element.Text ?? string.Empty)).Append("</text>\n");

		if (hasLink) _sb.Append("  </a>\n");
	}

	// Baseline y-offset in the text's local (post-counter-flip, y-down) frame for the
	// style's vertical anchor. Matches PdfRenderer.DrawText — FontMetrics.Descent is
	// negative, so Middle resolves to (ascent − |descent|) / 2 below the anchor point.
	private static double BaselineShift(TextStyle style)
	{
		if (style.VerticalAnchor == VerticalAnchor.Baseline) return 0.0;
		var m = FontMetrics.Measure(string.Empty, style);
		switch (style.VerticalAnchor)
		{
			case VerticalAnchor.Top: return m.Ascent;
			case VerticalAnchor.Middle: return (m.Ascent + m.Descent) / 2.0;
			case VerticalAnchor.Bottom: return m.Descent;
			default: return 0.0;
		}
	}

	// Per-text font attributes, emitted only when they differ from the inherited root
	// font-family (weight/style are never set on the root). Without these every text
	// rendered in the root stack while the PDF honoured the style — bold and custom
	// families silently disappeared from SVG output.
	private void AppendFontAttributes(TextStyle style)
	{
		var rootFamily = _options.FontFamily ?? SvgRenderOptions.DefaultFontFamily;
		var family = style.FontFamily?.Trim();
		if (!string.IsNullOrEmpty(family)
			&& !string.Equals(family, rootFamily.Trim(), StringComparison.OrdinalIgnoreCase)
			&& !string.Equals(family, FirstFamily(rootFamily), StringComparison.OrdinalIgnoreCase))
		{
			_sb.Append(" font-family='").Append(Escape(family).Replace("\"", "&quot;")).Append('\'');
		}
		if (style.Weight == FontWeight.Bold) _sb.Append(" font-weight='bold'");
		if (style.Style == FontStyle.Italic) _sb.Append(" font-style='italic'");
	}

	private static string FirstFamily(string stack)
	{
		var comma = stack.IndexOf(',');
		return (comma < 0 ? stack : stack.Substring(0, comma)).Trim().Trim('"', '\'');
	}

	// Draws the background rectangle behind a TextElement under the same transform the
	// text uses, so rotation is shared. Coordinates are in the text's local (post-flip)
	// frame: the horizontal anchor selects which side of x=0 the run extends to, and the
	// dominant-baseline=middle convention puts the visual middle of the line at y=0.
	private void AppendTextBackgroundRect(TextElement element, TextStyle style, string transform)
	{
		var measured = FontMetrics.Measure(element.Text ?? string.Empty, style);
		var width = measured.Width;
		var ascent = measured.Ascent;
		var descent = Math.Abs(measured.Descent);
		var lineHeightMultiplier = Math.Max(1.0, style.LineHeight);
		var extra = (ascent + descent) * (lineHeightMultiplier - 1.0) * 0.5;
		ascent += extra;
		descent += extra;

		double x;
		switch (style.HorizontalAnchor)
		{
			case TextAnchor.Center: x = -width / 2.0; break;
			case TextAnchor.Right: x = -width; break;
			default: x = 0; break;
		}
		var height = ascent + descent;
		// The rect's top sits one (inflated) ascent above wherever the baseline lands for
		// the style's vertical anchor, so the background stays glued to the glyphs in all
		// four anchor modes.
		var y = BaselineShift(style) - ascent;

		var p = element.BackgroundPadding;
		if (p > 0)
		{
			x -= p; y -= p;
			width += 2 * p; height += 2 * p;
		}

		var radius = Math.Max(0, element.BackgroundCornerRadius);

		_sb.Append("  <rect x='").Append(F(x)).Append("' y='").Append(F(y))
			.Append("' width='").Append(F(width)).Append("' height='").Append(F(height)).Append('\'');
		if (radius > 0)
			_sb.Append(" rx='").Append(F(radius)).Append("' ry='").Append(F(radius)).Append('\'');
		_sb.Append(" fill='").Append(ColorValue(element.Background.Value)).Append('\'');
		_sb.Append(" transform='").Append(transform).Append("' />\n");
	}

	public void Visit(TextBlockElement element)
	{
		// Phase 2 doesn't ship layout; render as a single-line TextElement at the box's
		// top-left so the visitor is complete. Phase 7's TextFlow replaces this.
		if (element == null) return;
		var style = element.Style ?? new TextStyle();
		var t = new TextElement
		{
			Text = element.Text,
			Position = new Point2D(element.Box.MinX, element.Box.MaxY),
			Style = style,
			Id = element.Id,
			CssClass = element.CssClass,
			Metadata = element.Metadata,
		};
		Visit(t);
	}

	public void Visit(ImageElement element)
	{
		// Phase 2 stub — emission lands when a real use case appears (logos in title
		// blocks, Phase 8). Keep the visitor complete by no-op'ing for now.
		_ = element;
	}

	public void Visit(DimensionElement element)
	{
		if (element == null) return;
		_sb.Append("  <g class='dimension");
		if (!string.IsNullOrEmpty(element.CssClass)) _sb.Append(' ').Append(element.CssClass);
		_sb.Append('\'');
		if (!string.IsNullOrEmpty(element.Id)) _sb.Append(" id='").Append(Escape(element.Id)).Append('\'');
		_sb.Append(">\n");

		switch (element.Kind)
		{
			case DimensionKind.Linear: AppendLinearDimensionBody(element); break;
			case DimensionKind.Angular: AppendAngularDimensionBody(element); break;
		}

		_sb.Append("  </g>\n");
	}

	public void Visit(LeaderElement element)
	{
		if (element == null || element.Points.Count < 2) return;
		// Pointer polyline.
		_sb.Append("  <path");
		AppendIdClass(element.Id, element.CssClass);
		_sb.Append(" d='M ").Append(F(element.Points[0].X)).Append(' ').Append(F(element.Points[0].Y));
		for (var i = 1; i < element.Points.Count; i++)
			_sb.Append(" L ").Append(F(element.Points[i].X)).Append(' ').Append(F(element.Points[i].Y));
		_sb.Append('\'');

		AppendStyle(element.Stroke, fill: null, defaultFillNone: true);
		if (element.Head == LeaderHead.Arrow)
			_sb.Append(" marker-end='url(#").Append(LeaderArrowMarkerId(element)).Append(")'");
		AppendData(element.Metadata);
		_sb.Append(" />\n");

		if (!string.IsNullOrEmpty(element.Text))
		{
			var anchor = element.Points[element.Points.Count - 1];
			var t = new TextElement
			{
				Text = element.Text,
				Position = anchor,
				Style = element.TextStyle ?? new TextStyle(),
			};
			Visit(t);
		}
	}

	public void Visit(HatchElement element)
	{
		if (element == null || element.Boundary.IsEmpty) return;
		var bounds = element.Boundary.ComputeBounds();
		if (bounds.IsEmpty) return;

		var line = element.LineStyle ?? new Stroke { Width = 0.18 };
		var spacing = element.Spacing > 0 ? element.Spacing : 2.0;
		var clipRule = element.FillRule == FillRule.NonZero ? "nonzero" : "evenodd";

		// Mirrors PdfRenderer.Visit(HatchElement): background fill, pattern strokes clipped
		// to the boundary, then the boundary outline so sparse patterns stay legible.
		if (element.BackgroundColor.A > 0)
		{
			_sb.Append("  <path d='");
			SvgPathBuilder.AppendTo(_sb, element.Boundary);
			_sb.Append("' fill='").Append(ColorValue(element.BackgroundColor))
				.Append("' fill-rule='").Append(clipRule).Append("' stroke='none' />\n");
		}

		if (element.Pattern == HatchPatternKind.Solid)
		{
			_sb.Append("  <path d='");
			SvgPathBuilder.AppendTo(_sb, element.Boundary);
			_sb.Append("' fill='").Append(ColorValue(line.Color)).Append('\'');
			if (line.Opacity < 1.0) _sb.Append(" fill-opacity='").Append(F(line.Opacity)).Append('\'');
			_sb.Append(" fill-rule='").Append(clipRule).Append("' stroke='none' />\n");
		}
		else
		{
			var clipId = $"selva-hatchclip-{_hatchClipCounter++}";
			_sb.Append("  <clipPath id='").Append(clipId).Append("'><path d='");
			SvgPathBuilder.AppendTo(_sb, element.Boundary);
			_sb.Append("' clip-rule='").Append(clipRule).Append("' /></clipPath>\n");
			_sb.Append("  <g clip-path='url(#").Append(clipId).Append(")'>\n");
			switch (element.Pattern)
			{
				case HatchPatternKind.Lines:
					AppendHatchLines(bounds, element.AngleDegrees, spacing, line);
					break;
				case HatchPatternKind.CrossHatch:
					AppendHatchLines(bounds, element.AngleDegrees, spacing, line);
					AppendHatchLines(bounds, element.AngleDegrees + 90.0, spacing, line);
					break;
				case HatchPatternKind.Dots:
					AppendHatchDots(bounds, spacing, line);
					break;
			}
			_sb.Append("  </g>\n");
		}

		_sb.Append("  <path d='");
		SvgPathBuilder.AppendTo(_sb, element.Boundary);
		_sb.Append("' fill='none'");
		AppendHatchStrokeAttributes(line);
		_sb.Append(" />\n");
	}

	// Same sweep math as PdfRenderer.DrawHatchLines so the two outputs tile identically:
	// project the bbox corners onto the sweep axis, snap the first line to a spacing
	// multiple, and overshoot the line ends so clipped diagonals reach the corners.
	private void AppendHatchLines(BoundingBox bounds, double angleDegrees, double spacing, Stroke line)
	{
		if (spacing <= 0) return;
		var theta = angleDegrees * Math.PI / 180.0;
		var ux = Math.Cos(theta);
		var uy = Math.Sin(theta);
		var px = -uy;
		var py = ux;

		var corners = new[]
		{
			(bounds.MinX, bounds.MinY),
			(bounds.MaxX, bounds.MinY),
			(bounds.MaxX, bounds.MaxY),
			(bounds.MinX, bounds.MaxY),
		};
		double tMin = double.PositiveInfinity, tMax = double.NegativeInfinity;
		double sMin = double.PositiveInfinity, sMax = double.NegativeInfinity;
		foreach (var (x, y) in corners)
		{
			var t = x * px + y * py;
			var s = x * ux + y * uy;
			if (t < tMin) tMin = t;
			if (t > tMax) tMax = t;
			if (s < sMin) sMin = s;
			if (s > sMax) sMax = s;
		}

		var first = Math.Floor(tMin / spacing) * spacing;
		var s0 = sMin - spacing;
		var s1 = sMax + spacing;

		for (var t = first; t <= tMax + 1e-9; t += spacing)
		{
			var x0 = ux * s0 + px * t;
			var y0 = uy * s0 + py * t;
			var x1 = ux * s1 + px * t;
			var y1 = uy * s1 + py * t;
			_sb.Append("    <line x1='").Append(F(x0)).Append("' y1='").Append(F(y0))
				.Append("' x2='").Append(F(x1)).Append("' y2='").Append(F(y1)).Append('\'');
			AppendHatchStrokeAttributes(line);
			_sb.Append(" />\n");
		}
	}

	private void AppendHatchDots(BoundingBox bounds, double spacing, Stroke line)
	{
		if (spacing <= 0) return;
		// Radius matches PdfRenderer.DrawHatchDotsClipped so dot weight is identical.
		var radius = Math.Max(line.Width * 0.5, 0.15);
		var x0 = Math.Floor(bounds.MinX / spacing) * spacing;
		var y0 = Math.Floor(bounds.MinY / spacing) * spacing;
		for (var y = y0; y <= bounds.MaxY + 1e-9; y += spacing)
		{
			for (var x = x0; x <= bounds.MaxX + 1e-9; x += spacing)
			{
				_sb.Append("    <circle cx='").Append(F(x)).Append("' cy='").Append(F(y))
					.Append("' r='").Append(F(radius)).Append("' fill='").Append(ColorValue(line.Color)).Append('\'');
				if (line.Opacity < 1.0) _sb.Append(" fill-opacity='").Append(F(line.Opacity)).Append('\'');
				_sb.Append(" />\n");
			}
		}
	}

	private void AppendHatchStrokeAttributes(Stroke line)
	{
		_sb.Append(" stroke='").Append(ColorValue(line.Color)).Append('\'');
		_sb.Append(" stroke-width='").Append(F(line.Width)).Append('\'');
		if (line.Opacity < 1.0) _sb.Append(" stroke-opacity='").Append(F(line.Opacity)).Append('\'');
	}

	public void Visit(SymbolElement element)
	{
		if (element?.Definition == null) return;

		// Phase 10a: when the definition has an Id we collected during the pre-pass,
		// emit <use href="#id"> referencing the shared <symbol>. Anonymous definitions
		// (no Id) fall back to inline expansion — same semantics as before.
		var def = element.Definition;
		var hasId = !string.IsNullOrEmpty(def.Id) && _symbolDefs != null && _symbolDefs.ContainsKey(def.Id);
		if (hasId)
		{
			_sb.Append("  <use href='#").Append(Escape(def.Id)).Append('\'');
			if (element.Position.X != 0)
				_sb.Append(" x='").Append(F(element.Position.X)).Append('\'');
			if (element.Position.Y != 0)
				_sb.Append(" y='").Append(F(element.Position.Y)).Append('\'');
			if (!element.Transform.IsIdentity)
			{
				_sb.Append(" transform='matrix(")
					.Append(F(element.Transform.A)).Append(' ').Append(F(element.Transform.B)).Append(' ')
					.Append(F(element.Transform.C)).Append(' ').Append(F(element.Transform.D)).Append(' ')
					.Append(F(element.Transform.E)).Append(' ').Append(F(element.Transform.F)).Append(")'");
			}
			_sb.Append(" />\n");
			return;
		}

		// Inline-expand anonymous definitions.
		var hasOffset = element.Position.X != 0 || element.Position.Y != 0;
		var hasTransform = !element.Transform.IsIdentity;

		if (hasOffset || hasTransform)
		{
			_sb.Append("  <g transform='");
			if (hasOffset)
			{
				_sb.Append("translate(").Append(F(element.Position.X)).Append(' ').Append(F(element.Position.Y)).Append(')');
				if (hasTransform) _sb.Append(' ');
			}
			if (hasTransform)
			{
				_sb.Append("matrix(")
					.Append(F(element.Transform.A)).Append(' ').Append(F(element.Transform.B)).Append(' ')
					.Append(F(element.Transform.C)).Append(' ').Append(F(element.Transform.D)).Append(' ')
					.Append(F(element.Transform.E)).Append(' ').Append(F(element.Transform.F)).Append(')');
			}
			_sb.Append("'>\n");
		}

		foreach (var child in element.Definition.Children) child?.Accept(this);

		if (hasOffset || hasTransform) _sb.Append("  </g>\n");
	}

	// ============================================================================
	// Dimension body emission (ported from LinearDimensionBuilder/AngularDimensionBuilder)
	// ============================================================================

	private void AppendLinearDimensionBody(DimensionElement element)
	{
		var style = element.Style ?? new DimensionStyle();
		var ax = element.A.X; var ay = element.A.Y;
		var bx = element.B.X; var by = element.B.Y;
		var offset = element.Offset;

		var dx = bx - ax;
		var dy = by - ay;
		var len = Math.Sqrt(dx * dx + dy * dy);
		if (len < 1e-9) return;

		var ux = dx / len;
		var uy = dy / len;
		var nx = -uy;
		var ny = ux;

		var ts = style.TextSize;
		var extGap = ts * style.ExtensionGapFactor;
		var extOver = ts * style.ExtensionOvershootFactor;
		var arrowSize = style.ResolvedArrowSize();

		var sign = offset >= 0 ? 1 : -1;
		var absOffset = Math.Abs(offset);
		// Witness line length runs from extStart back toward the measured point. Without a
		// cap it equals |offset| - extGap, which gets absurd for far-offset dims. Cap to
		// ts * ExtensionLengthFactor (AutoCAD/Revit-style) when set.
		var fullExtLen = Math.Max(0.0, absOffset - extGap);
		var maxExtLen = style.ExtensionLengthFactor > 0
			? ts * style.ExtensionLengthFactor
			: fullExtLen;
		var extLen = Math.Min(fullExtLen, maxExtLen);
		// extStart sits between the measured point and the dim line; extEnd is past the dim line by extOver.
		var extStartOffset = absOffset - extLen;
		var extStartA = (X: ax + nx * extStartOffset * sign, Y: ay + ny * extStartOffset * sign);
		var extStartB = (X: bx + nx * extStartOffset * sign, Y: by + ny * extStartOffset * sign);
		var extEndA = (X: ax + nx * (offset + extOver * sign), Y: ay + ny * (offset + extOver * sign));
		var extEndB = (X: bx + nx * (offset + extOver * sign), Y: by + ny * (offset + extOver * sign));

		var dimA = (X: ax + nx * offset, Y: ay + ny * offset);
		var dimB = (X: bx + nx * offset, Y: by + ny * offset);

		var flipArrows = style.AutoFlipArrows
			&& style.TickKind == DimensionTickKind.Arrow
			&& len < arrowSize * 3.0;

		var text = string.IsNullOrEmpty(element.Label)
			? len.ToString("0.##", Inv)
			: element.Label;
		var textLift = style.TextPlacement == DimensionTextPlacement.BreakLine
			? 0.0
			: ts * style.TextLiftFactor;
		var midX = (dimA.X + dimB.X) * 0.5 + nx * textLift * sign;
		var midY = (dimA.Y + dimB.Y) * 0.5 + ny * textLift * sign;

		var angleDeg = Math.Atan2(uy, ux) * 180.0 / Math.PI;
		if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

		var strokeAttr = $"stroke='{ColorValue(style.Color)}' stroke-width='{F(style.StrokeWidth)}' fill='none' vector-effect='non-scaling-stroke'";
		var arrowMarkerId = DimArrowMarkerId(style);

		AppendDimLine(strokeAttr, extStartA.X, extStartA.Y, extEndA.X, extEndA.Y);
		AppendDimLine(strokeAttr, extStartB.X, extStartB.Y, extEndB.X, extEndB.Y);

		if (style.TextPlacement == DimensionTextPlacement.BreakLine)
		{
			// Real glyph advance from the bundled font; the 0.55 × charCount heuristic only
			// kicks in when style.FontFamily isn't bundled.
			var textWidth = FontMetrics.Measure(text, style.FontFamily, ts).Width;
			var textHalfWidth = textWidth * 0.5 + ts * style.TextSidePaddingFactor;
			var midWorldX = (dimA.X + dimB.X) * 0.5;
			var midWorldY = (dimA.Y + dimB.Y) * 0.5;
			var gapAx = midWorldX - ux * textHalfWidth;
			var gapAy = midWorldY - uy * textHalfWidth;
			var gapBx = midWorldX + ux * textHalfWidth;
			var gapBy = midWorldY + uy * textHalfWidth;

			AppendDimSegment(strokeAttr, dimA.X, dimA.Y, gapAx, gapAy, style.TickKind, flipArrows, startTick: true, endTick: false, arrowMarkerId);
			AppendDimSegment(strokeAttr, gapBx, gapBy, dimB.X, dimB.Y, style.TickKind, flipArrows, startTick: false, endTick: true, arrowMarkerId);
		}
		else
		{
			AppendDimSegment(strokeAttr, dimA.X, dimA.Y, dimB.X, dimB.Y, style.TickKind, flipArrows, startTick: true, endTick: true, arrowMarkerId);
		}

		if (flipArrows && style.TickKind == DimensionTickKind.Arrow)
		{
			var stub = arrowSize * 1.5;
			var outAx = dimA.X - ux * stub;
			var outAy = dimA.Y - uy * stub;
			var outBx = dimB.X + ux * stub;
			var outBy = dimB.Y + uy * stub;
			_sb.Append("    <line ").Append(strokeAttr)
				.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'")
				.Append(" x1='").Append(F(outAx)).Append("' y1='").Append(F(outAy))
				.Append("' x2='").Append(F(dimA.X)).Append("' y2='").Append(F(dimA.Y))
				.Append("' />\n");
			_sb.Append("    <line ").Append(strokeAttr)
				.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'")
				.Append(" x1='").Append(F(outBx)).Append("' y1='").Append(F(outBy))
				.Append("' x2='").Append(F(dimB.X)).Append("' y2='").Append(F(dimB.Y))
				.Append("' />\n");
		}

		_sb.Append("    <text x='0' y='0'")
			.Append(" font-size='").Append(F(ts)).Append('\'')
			.Append(" fill='").Append(ColorValue(style.Color)).Append('\'')
			.Append(" text-anchor='middle' dominant-baseline='middle'")
			.Append(" transform='translate(").Append(F(midX)).Append(' ').Append(F(midY))
			.Append(") scale(1 -1) rotate(").Append(F(-angleDeg)).Append(")'")
			.Append('>').Append(Escape(text)).Append("</text>\n");
	}

	private void AppendAngularDimensionBody(DimensionElement element)
	{
		var style = element.Style ?? new DimensionStyle();
		var vx = element.Vertex.X; var vy = element.Vertex.Y;
		var ax = element.A.X; var ay = element.A.Y;
		var bx = element.B.X; var by = element.B.Y;

		var dax = ax - vx; var day = ay - vy;
		var dbx = bx - vx; var dby = by - vy;
		var lenA = Math.Sqrt(dax * dax + day * day);
		var lenB = Math.Sqrt(dbx * dbx + dby * dby);
		if (lenA < 1e-9 || lenB < 1e-9) return;

		// Auto-radius matches legacy: 30% of shorter arm.
		var radius = Math.Min(lenA, lenB) * 0.3;

		var uax = dax / lenA; var uay = day / lenA;
		var ubx = dbx / lenB; var uby = dby / lenB;

		var dot = uax * ubx + uay * uby;
		var cross = uax * uby - uay * ubx;
		var smallTheta = Math.Atan2(cross, dot);
		var absSmall = Math.Abs(smallTheta);
		if (absSmall < 1e-6) return;

		// DimensionElement doesn't yet carry a "reflex" flag — Phase 3 may add one. For
		// now small-angle (non-reflex) matches the typical builder use.
		var theta = smallTheta;
		var absTheta = Math.Abs(theta);
		var sweepCcw = theta > 0;

		var ts = style.TextSize;
		var arrowSize = style.ResolvedArrowSize();

		var arcStartX = vx + uax * radius;
		var arcStartY = vy + uay * radius;
		var arcEndX = vx + ubx * radius;
		var arcEndY = vy + uby * radius;

		var bisX = uax + ubx;
		var bisY = uay + uby;
		var bisLen = Math.Sqrt(bisX * bisX + bisY * bisY);
		if (bisLen < 1e-9)
		{
			bisX = sweepCcw ? -uay : uay;
			bisY = sweepCcw ? uax : -uax;
			bisLen = 1.0;
		}
		bisX /= bisLen; bisY /= bisLen;

		var strokeAttr = $"stroke='{ColorValue(style.Color)}' stroke-width='{F(style.StrokeWidth)}' fill='none' vector-effect='non-scaling-stroke'";
		var arrowMarkerId = DimArrowMarkerId(style);

		var arcLen = absTheta * radius;
		var flipArrows = style.AutoFlipArrows
			&& style.TickKind == DimensionTickKind.Arrow
			&& arcLen < arrowSize * 3.0;

		var largeArcFlag = absTheta > Math.PI ? 1 : 0;
		var sweepFlag = sweepCcw ? 1 : 0;

		_sb.Append("    <path ").Append(strokeAttr);
		if (style.TickKind == DimensionTickKind.Arrow && !flipArrows)
		{
			_sb.Append(" marker-start='url(#").Append(arrowMarkerId).Append(")'");
			_sb.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'");
		}
		else if (style.TickKind == DimensionTickKind.Tick)
		{
			_sb.Append(" marker-start='url(#selva-dim-tick)'");
			_sb.Append(" marker-end='url(#selva-dim-tick)'");
		}
		_sb.Append(" d='M ").Append(F(arcStartX)).Append(' ').Append(F(arcStartY))
			.Append(" A ").Append(F(radius)).Append(' ').Append(F(radius))
			.Append(" 0 ").Append(largeArcFlag).Append(' ').Append(sweepFlag).Append(' ')
			.Append(F(arcEndX)).Append(' ').Append(F(arcEndY))
			.Append("' />\n");

		if (flipArrows && style.TickKind == DimensionTickKind.Arrow)
		{
			var stub = arrowSize * 1.5;

			double tStartX, tStartY;
			if (sweepCcw) { tStartX = -uay; tStartY = uax; }
			else { tStartX = uay; tStartY = -uax; }
			var outStartX = arcStartX - tStartX * stub;
			var outStartY = arcStartY - tStartY * stub;

			double tEndX, tEndY;
			if (sweepCcw) { tEndX = -uby; tEndY = ubx; }
			else { tEndX = uby; tEndY = -ubx; }
			var outEndX = arcEndX + tEndX * stub;
			var outEndY = arcEndY + tEndY * stub;

			_sb.Append("    <line ").Append(strokeAttr)
				.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'")
				.Append(" x1='").Append(F(outStartX)).Append("' y1='").Append(F(outStartY))
				.Append("' x2='").Append(F(arcStartX)).Append("' y2='").Append(F(arcStartY))
				.Append("' />\n");
			_sb.Append("    <line ").Append(strokeAttr)
				.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'")
				.Append(" x1='").Append(F(outEndX)).Append("' y1='").Append(F(outEndY))
				.Append("' x2='").Append(F(arcEndX)).Append("' y2='").Append(F(arcEndY))
				.Append("' />\n");
		}

		var degrees = absTheta * 180.0 / Math.PI;
		var text = string.IsNullOrEmpty(element.Label)
			? degrees.ToString("0.##", Inv) + "°"
			: element.Label;

		var textLift = ts * style.TextLiftFactor;
		var textRadius = radius + textLift;
		var midX = vx + bisX * textRadius;
		var midY = vy + bisY * textRadius;

		var bisAngleDeg = Math.Atan2(bisY, bisX) * 180.0 / Math.PI;
		var tangentAngleDeg = bisAngleDeg - 90.0;
		if (tangentAngleDeg > 90 || tangentAngleDeg < -90) tangentAngleDeg += 180;

		_sb.Append("    <text x='0' y='0'")
			.Append(" font-size='").Append(F(ts)).Append('\'')
			.Append(" fill='").Append(ColorValue(style.Color)).Append('\'')
			.Append(" text-anchor='middle' dominant-baseline='middle'")
			.Append(" transform='translate(").Append(F(midX)).Append(' ').Append(F(midY))
			.Append(") scale(1 -1) rotate(").Append(F(-tangentAngleDeg)).Append(")'")
			.Append('>').Append(Escape(text)).Append("</text>\n");
	}

	private void AppendDimLine(string strokeAttr, double x1, double y1, double x2, double y2)
	{
		_sb.Append("    <line ").Append(strokeAttr)
			.Append(" x1='").Append(F(x1)).Append("' y1='").Append(F(y1))
			.Append("' x2='").Append(F(x2)).Append("' y2='").Append(F(y2))
			.Append("' />\n");
	}

	private void AppendDimSegment(
		string strokeAttr,
		double x1, double y1, double x2, double y2,
		DimensionTickKind tickKind, bool flipArrows,
		bool startTick, bool endTick, string arrowMarkerId = "selva-dim-arrow-fallback")
	{
		_sb.Append("    <line ").Append(strokeAttr);

		if (tickKind == DimensionTickKind.Arrow && !flipArrows)
		{
			if (startTick) _sb.Append(" marker-start='url(#").Append(arrowMarkerId).Append(")'");
			if (endTick) _sb.Append(" marker-end='url(#").Append(arrowMarkerId).Append(")'");
		}
		else if (tickKind == DimensionTickKind.Tick)
		{
			if (startTick) _sb.Append(" marker-start='url(#selva-dim-tick)'");
			if (endTick) _sb.Append(" marker-end='url(#selva-dim-tick)'");
		}

		_sb.Append(" x1='").Append(F(x1)).Append("' y1='").Append(F(y1))
			.Append("' x2='").Append(F(x2)).Append("' y2='").Append(F(y2))
			.Append("' />\n");
	}

	// ============================================================================
	// Style + attribute helpers (mirror legacy SvgWriter)
	// ============================================================================

	private void AppendIdClass(string id, string cssClass)
	{
		if (!string.IsNullOrEmpty(id)) _sb.Append(" id='").Append(Escape(id)).Append('\'');
		if (!string.IsNullOrEmpty(cssClass)) _sb.Append(" class='").Append(Escape(cssClass)).Append('\'');
	}

	private void AppendData(IReadOnlyDictionary<string, string> metadata)
	{
		if (metadata == null) return;
		foreach (var kv in metadata)
		{
			if (string.IsNullOrEmpty(kv.Key) || kv.Key.StartsWith("_")) continue;
			_sb.Append(" data-").Append(kv.Key).Append("='").Append(Escape(kv.Value)).Append('\'');
		}
	}

	private void AppendStyle(Stroke stroke, Fill fill, bool defaultFillNone)
	{
		// Mirrors SvgWriter.AppendStyle's emission order: fill first, then stroke.
		if (fill != null)
		{
			if (fill.Pattern != HatchPattern.None)
				_sb.Append(" fill='url(#").Append(HatchPatternId(fill)).Append(")'");
			else
				_sb.Append(" fill='").Append(ColorValue(fill.Color)).Append('\'');
			if (fill.Opacity < 1.0) _sb.Append(" fill-opacity='").Append(F(fill.Opacity)).Append('\'');
		}
		else
		{
			_sb.Append(" fill='none'");
		}

		if (stroke != null && stroke.Width > 0)
		{
			_sb.Append(" stroke='").Append(ColorValue(stroke.Color)).Append('\'');
			_sb.Append(" stroke-width='").Append(F(stroke.Width)).Append('\'');
			if (stroke.Opacity < 1.0) _sb.Append(" stroke-opacity='").Append(F(stroke.Opacity)).Append('\'');
			if (stroke.Cap != StrokeCap.Butt)
				_sb.Append(" stroke-linecap='").Append(stroke.Cap.ToString().ToLowerInvariant()).Append('\'');
			if (stroke.Join != StrokeJoin.Miter)
				_sb.Append(" stroke-linejoin='").Append(stroke.Join.ToString().ToLowerInvariant()).Append('\'');
			if (stroke.DashArray != null && stroke.DashArray.Count > 0)
			{
				_sb.Append(" stroke-dasharray='");
				for (var i = 0; i < stroke.DashArray.Count; i++)
				{
					if (i > 0) _sb.Append(' ');
					_sb.Append(F(stroke.DashArray[i]));
				}
				_sb.Append('\'');
			}
		}
		else if (stroke == null && defaultFillNone && fill == null)
		{
			// Legacy: a null PathStyleData emitted "fill='none' stroke='black'". Replicate
			// for parity by overriding the earlier fill='none' write when both are null.
			// Both fill and stroke being null is the path through the (fill==null) branch
			// above, so we already wrote " fill='none'"; just append the default stroke.
			_sb.Append(" stroke='black'");
		}
		else
		{
			_sb.Append(" stroke='none'");
		}
	}

	private static bool HasMultipleMoveTos(Path path)
	{
		if (path == null || path.IsEmpty) return false;
		var count = 0;
		foreach (var s in path)
		{
			if (s is PathSegment.MoveTo)
			{
				count++;
				if (count > 1) return true;
			}
		}
		return false;
	}

	private static string AnchorToSvg(TextAnchor anchor) => anchor switch
	{
		TextAnchor.Center => "middle",
		TextAnchor.Right => "end",
		_ => "start",
	};

	internal static string ColorValue(Color color)
	{
		switch (color.Space)
		{
			case ColorSpace.Named:
				return color.Name ?? "currentColor";
			case ColorSpace.Cmyk:
				// SVG doesn't natively support CMYK; convert to sRGB for emission. PDF
				// renderer will keep CMYK native. Same conversion the W3C describes.
				var r = (1 - color.C) * (1 - color.K);
				var g = (1 - color.M) * (1 - color.K);
				var b = (1 - color.Y) * (1 - color.K);
				return color.A < 1f
					? $"rgba({Round255(r)},{Round255(g)},{Round255(b)},{F(color.A)})"
					: $"rgb({Round255(r)},{Round255(g)},{Round255(b)})";
			default:
				return color.A < 1f
					? $"rgba({Round255(color.R)},{Round255(color.G)},{Round255(color.B)},{F(color.A)})"
					: $"rgb({Round255(color.R)},{Round255(color.G)},{Round255(color.B)})";
		}
	}

	private static int Round255(double v) => (int)Math.Round(v * 255.0, MidpointRounding.AwayFromZero);

	private static string F(double v) => v.ToString("0.######", Inv);

	private static string Escape(string s)
	{
		if (string.IsNullOrEmpty(s)) return s;
		return s.Replace("&", "&amp;").Replace("'", "&apos;").Replace("<", "&lt;").Replace(">", "&gt;");
	}
}
