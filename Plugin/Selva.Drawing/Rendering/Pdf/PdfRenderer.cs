using System;
using System.Collections.Generic;
using System.IO;
using PdfSharpCore.Drawing;
using PdfSharpCore.Pdf;
using Selva.Drawing.Fonts;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using PdfFontStyle = PdfSharpCore.Drawing.XFontStyle;
using ModelFontStyle = Selva.Drawing.Model.Style.FontStyle;
using PdfSharpColorMode = PdfSharpCore.Pdf.PdfColorMode;

namespace Selva.Drawing.Rendering.Pdf;

// Walks a Document and emits a PDF byte array via PdfSharpCore. Phase 5 target: each
// element type from the model emits the correct vector primitives, text uses bundled
// Inter via PdfFontEmbedder, and Document.Metadata flows through to the /Info dictionary.
//
// Coordinate system: model is Y-up in millimetres, origin bottom-left of the page.
// PdfSharpCore's XGraphics is Y-down with origin top-left. We apply one root transform
// (translate(0, pageHeight) then scale(1,-1)) so model coordinates flow naturally; every
// element below sees Y-up model space. Text is the one exception — glyphs would render
// upside-down under that flip, so each text run counter-flips locally with scale(1,-1)
// around the anchor point, mirroring the SvgRenderer's pattern.
public sealed class PdfRenderer : IRenderer<byte[]>, IElementVisitor
{
	private readonly PdfRenderOptions _options;
	private XGraphics _gfx;
	private double _pageHeightMm;

	// Per-page transient state. Reset at each RenderPage entry. Hyperlink rects accumulate
	// during the visitor pass; we attach them to the PdfPage after the visitor finishes so
	// the page's MediaBox is known and rect math is straightforward.
	private PdfPage _currentPdfPage;
	private double _pageTranslateXMm;
	private double _pageTranslateYMm;
	private List<(BoundingBox WorldBoundsMm, string Url)> _pendingLinks;
	private List<PdfPage> _renderedPages;

	// Phase 10a: SymbolDefinition.Id → cached Form XObject. Built once per page in a
	// pre-pass; Visit(SymbolElement) draws the form via _gfx.DrawImage(form,...) which
	// causes PdfSharpCore to share the underlying Form XObject across instances.
	// Form-local interior is set up Y-up so child draw code works identically to the
	// inline-expansion path. Anonymous definitions (no Id) keep inline expansion.
	private Dictionary<string, SymbolFormCache> _symbolForms;
	private PdfDocument _pdfDocument;

	private readonly struct SymbolFormCache
	{
		public SymbolFormCache(XForm form, BoundingBox bounds, double widthMm, double heightMm)
		{
			Form = form;
			Bounds = bounds;
			WidthMm = widthMm;
			HeightMm = heightMm;
		}
		public XForm Form { get; }
		// Bounds in the symbol's local coord system. Used to translate the DrawImage call
		// so the form's bottom-left lands at the right world position.
		public BoundingBox Bounds { get; }
		// Form's actual extent in mm (≥ 1mm in each dimension to satisfy PdfSharpCore).
		public double WidthMm { get; }
		public double HeightMm { get; }
	}

	public PdfRenderer() : this(new PdfRenderOptions()) { }
	public PdfRenderer(PdfRenderOptions options)
	{
		_options = options ?? new PdfRenderOptions();
	}

	public byte[] Render(Document document)
	{
		if (document == null) throw new ArgumentNullException(nameof(document));
		PdfFontEmbedder.EnsureInstalled();

		using var pdf = new PdfDocument();
		// Document-level colour mode (Rgb/Cmyk). PdfSharpCore has no per-page override —
		// every content stream writes operators in the configured mode, converting input
		// colours as needed. CMYK is the right choice for print preflight; Rgb is the
		// default for screen.
		pdf.Options.ColorMode = _options.ColorMode == PdfColorMode.Cmyk
			? PdfSharpColorMode.Cmyk
			: PdfSharpColorMode.Rgb;
		ApplyMetadata(pdf, document.Metadata);

		_pdfDocument = pdf;
		_renderedPages = new List<PdfPage>();

		// PDF natively supports multi-page documents — append one PdfPage per Page in the
		// Document. If a Document has zero pages we still emit one blank A4 so the file is
		// well-formed (same fallback the SVG renderer uses).
		if (document.Pages.Count == 0)
		{
			RenderPage(pdf, document, new Page { Content = new GroupElement() });
		}
		else
		{
			foreach (var page in document.Pages) RenderPage(pdf, document, page);
		}

		// Phase 9: emit XMP metadata + outlines after pages exist (outlines need page refs;
		// XMP is independent but goes here for symmetry).
		if (_options.EmitXmpMetadata) PdfXmpMetadata.Attach(pdf, document.Metadata);
		if (_options.EmitOutlines) ApplyOutlines(pdf, document, _renderedPages);

		_renderedPages = null;
		_pdfDocument = null;

		using var ms = new MemoryStream();
		pdf.Save(ms, false);
		return ms.ToArray();
	}

	private void RenderPage(PdfDocument pdf, Document document, Page page)
	{
		// Phase 7: resolve any LayoutElements (Stack/Grid/Frame/TextFlow/Table) into
		// primitive elements before walking the visitor. The visitor surface stays narrow.
		page = LayoutPass.ResolvePage(page);

		var pdfPage = pdf.AddPage();

		double pageWidthMm, pageHeightMm;
		double translateX, translateY;
		var contentBounds = MeasureForViewBox(page.Content);

		if (_options.AutoFitToContent && !contentBounds.IsEmpty)
		{
			pageWidthMm = contentBounds.Width + _options.Padding * 2;
			pageHeightMm = contentBounds.Height + _options.Padding * 2;
			// Place the content's bbox so its (MinX, MinY) sits at (Padding, Padding) in PDF
			// world space. PDF world space here is still Y-up because we apply the flip at
			// the XGraphics level below.
			translateX = _options.Padding - contentBounds.MinX;
			translateY = _options.Padding - contentBounds.MinY;
		}
		else if (contentBounds.IsEmpty && _options.AutoFitToContent)
		{
			// No content and no fixed paper size: emit a blank A4 page (matches the SVG
			// renderer's "empty document" behaviour of an empty <svg>).
			pageWidthMm = HasPaperSize(page) ? page.Size.WidthMm : PaperSize.A4.WidthMm;
			pageHeightMm = HasPaperSize(page) ? page.Size.HeightMm : PaperSize.A4.HeightMm;
			translateX = 0;
			translateY = 0;
		}
		else
		{
			pageWidthMm = page.Size.WidthMm;
			pageHeightMm = page.Size.HeightMm;
			translateX = 0;
			translateY = 0;
		}

		pdfPage.Width = XUnit.FromMillimeter(pageWidthMm);
		pdfPage.Height = XUnit.FromMillimeter(pageHeightMm);

		_pageHeightMm = pageHeightMm;
		_currentPdfPage = pdfPage;
		_pageTranslateXMm = translateX;
		_pageTranslateYMm = translateY;
		_pendingLinks = _options.EmitHyperlinks ? new List<(BoundingBox, string)>() : null;

		// Phase 10a: build Form XObjects for every reachable SymbolDefinition with an Id,
		// before the page graphics is opened. PdfSharpCore reuses Form XObjects when the
		// same XForm instance is drawn multiple times, so the underlying PDF resource is
		// emitted once per definition.
		_symbolForms = BuildSymbolForms(pdf, page.Content);

		_gfx = XGraphics.FromPdfPage(pdfPage, XGraphicsUnit.Millimeter);

		// Y-flip the world: after this transform, model (0,0) maps to the page's bottom-left
		// and +Y goes up the page.
		_gfx.TranslateTransform(0, pageHeightMm);
		_gfx.ScaleTransform(1, -1);

		// Auto-fit translate to position content with padding.
		if (translateX != 0 || translateY != 0) _gfx.TranslateTransform(translateX, translateY);

		page.Content?.Accept(this);

		_gfx.Dispose();
		_gfx = null;

		// Attach link annotations after the visitor finishes — by now the page's MediaBox
		// is fixed and PdfPage.AddWebLink can resolve coordinates correctly. Link rects in
		// PDF user space (points, Y up from page bottom-left).
		if (_pendingLinks != null && _pendingLinks.Count > 0)
		{
			foreach (var link in _pendingLinks) AddWebLink(pdfPage, link.WorldBoundsMm, link.Url);
		}
		_pendingLinks = null;
		_currentPdfPage = null;
		_symbolForms = null;

		_renderedPages?.Add(pdfPage);
	}

	private void AddWebLink(PdfPage pdfPage, BoundingBox worldBoundsMm, string url)
	{
		// Model coords are Y-up; the page-level translate already shifts model->PDF user
		// space. PDF rectangles also Y-up from bottom-left, so the rect is just a unit
		// conversion (mm → points).
		var minXMm = worldBoundsMm.MinX + _pageTranslateXMm;
		var maxXMm = worldBoundsMm.MaxX + _pageTranslateXMm;
		var minYMm = worldBoundsMm.MinY + _pageTranslateYMm;
		var maxYMm = worldBoundsMm.MaxY + _pageTranslateYMm;

		var bottomLeft = new XPoint(XUnit.FromMillimeter(minXMm).Point, XUnit.FromMillimeter(minYMm).Point);
		var topRight = new XPoint(XUnit.FromMillimeter(maxXMm).Point, XUnit.FromMillimeter(maxYMm).Point);
		pdfPage.AddWebLink(new PdfRectangle(bottomLeft, topRight), url);
	}

	private static bool HasPaperSize(Page page) => page.Size.WidthMm > 0 && page.Size.HeightMm > 0;

	private static void ApplyMetadata(PdfDocument pdf, DocumentMetadata metadata)
	{
		if (metadata == null) return;
		if (!string.IsNullOrEmpty(metadata.Title)) pdf.Info.Title = metadata.Title;
		if (!string.IsNullOrEmpty(metadata.Author)) pdf.Info.Author = metadata.Author;
		if (!string.IsNullOrEmpty(metadata.Subject)) pdf.Info.Subject = metadata.Subject;
		if (!string.IsNullOrEmpty(metadata.Creator)) pdf.Info.Creator = metadata.Creator;
		// Note: PdfSharpCore stamps its own /Producer; we override only when caller asked.
		if (!string.IsNullOrEmpty(metadata.Producer)) pdf.Info.Elements.SetString("/Producer", metadata.Producer);
		if (metadata.Keywords != null && metadata.Keywords.Count > 0)
			pdf.Info.Keywords = string.Join("; ", metadata.Keywords);
		if (metadata.CreatedAt.HasValue) pdf.Info.CreationDate = metadata.CreatedAt.Value;
		if (metadata.ModifiedAt.HasValue) pdf.Info.ModificationDate = metadata.ModifiedAt.Value;
	}

	// Phase 9: build the navigation outline. One top-level entry per Page, named after
	// Page.Title (or "Page N" when blank). Sub-entries for any DrawingView with a Caption,
	// giving multi-view sheets a sensible navigable tree.
	private static void ApplyOutlines(PdfDocument pdf, Document document, IReadOnlyList<PdfPage> pdfPages)
	{
		if (pdfPages == null || pdfPages.Count == 0) return;
		// We only have outlines for pages that have a corresponding model Page — when the
		// document had zero pages we synthesised a blank page; skip outlines in that case.
		if (document.Pages.Count == 0) return;

		var n = Math.Min(document.Pages.Count, pdfPages.Count);
		for (var i = 0; i < n; i++)
		{
			var modelPage = document.Pages[i];
			var pdfPage = pdfPages[i];
			var title = string.IsNullOrEmpty(modelPage.Title) ? "Page " + (i + 1) : modelPage.Title;
			var top = pdf.Outlines.Add(title, pdfPage, true);

			foreach (var view in EnumerateDrawingViewsWithCaptions(modelPage.Content))
			{
				top.Outlines.Add(view, pdfPage);
			}
		}
	}

	private static IEnumerable<string> EnumerateDrawingViewsWithCaptions(DrawElement element)
	{
		if (element == null) yield break;
		switch (element)
		{
			case DrawingView dv when !string.IsNullOrEmpty(dv.Caption):
				yield return dv.Caption;
				break;
			case GroupElement g:
				foreach (var c in g.Children)
					foreach (var caption in EnumerateDrawingViewsWithCaptions(c))
						yield return caption;
				break;
		}
	}

	// Same approach as SvgRenderer.MeasureForViewBox — raw geometry bounds, dimensions
	// expanded to their measured extents. Renderer-side measurement avoids the conservative
	// padding ComputeBounds adds for layout safety.
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
				bounds = bounds.Union(TransformBox(d.ComputeBounds(), t));
				break;
			case LeaderElement le:
				bounds = bounds.Union(TransformBox(le.ComputeBounds(), t));
				break;
			case ImageElement im:
				bounds = bounds.Union(TransformBox(im.ComputeBounds(), t));
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

	// ============================================================================
	// Symbol dedupe (Phase 10a)
	// ============================================================================

	private Dictionary<string, SymbolFormCache> BuildSymbolForms(PdfDocument pdf, DrawElement root)
	{
		var defs = new Dictionary<string, SymbolDefinition>(StringComparer.Ordinal);
		CollectSymbolDefinitions(root, defs);
		if (defs.Count == 0) return null;

		var cache = new Dictionary<string, SymbolFormCache>(defs.Count, StringComparer.Ordinal);
		foreach (var kvp in defs)
		{
			var def = kvp.Value;

			// Bounds in the symbol's own coord space — viewBox if provided, else union of
			// children's natural bounds. Empty defs are skipped (no useful form to build).
			var bounds = def.ViewBox.HasValue && !def.ViewBox.Value.IsEmpty
				? def.ViewBox.Value
				: UnionChildBounds(def.Children);
			if (bounds.IsEmpty) continue;

			// PdfSharpCore rejects XForms with zero width or height. A zero-area symbol
			// (e.g. a single horizontal line) gets a 1mm safety margin so the form is
			// constructable; the underlying content stays accurate because we use the
			// real bounds for both the form's translate and the page-side DrawImage call.
			var widthMm = bounds.Width > 0 ? bounds.Width : 1.0;
			var heightMm = bounds.Height > 0 ? bounds.Height : 1.0;
			var form = new XForm(pdf, XUnit.FromMillimeter(widthMm), XUnit.FromMillimeter(heightMm));

			using (var formGfx = XGraphics.FromForm(form))
			{
				// Render the form's interior in Y-up world coords (same convention as the
				// page) so the visitor reuses the existing draw paths verbatim. Form-local
				// origin is bottom-left after the flip; pre-translate so children at
				// (bounds.MinX..MaxX, bounds.MinY..MaxY) land at (0..w, 0..h).
				formGfx.TranslateTransform(0, heightMm);
				formGfx.ScaleTransform(1, -1);
				formGfx.TranslateTransform(-bounds.MinX, -bounds.MinY);

				var prevGfx = _gfx;
				_gfx = formGfx;
				try
				{
					foreach (var child in def.Children) child?.Accept(this);
				}
				finally
				{
					_gfx = prevGfx;
				}
			}
			form.DrawingFinished();

			cache[def.Id] = new SymbolFormCache(form, bounds, widthMm, heightMm);
		}
		return cache;
	}

	private static void CollectSymbolDefinitions(DrawElement element, Dictionary<string, SymbolDefinition> defs)
	{
		if (element == null) return;
		switch (element)
		{
			case GroupElement g:
				foreach (var c in g.Children) CollectSymbolDefinitions(c, defs);
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
					foreach (var c in s.Definition.Children) CollectSymbolDefinitions(c, defs);
				}
				break;
		}
	}

	private static BoundingBox UnionChildBounds(IReadOnlyList<DrawElement> children)
	{
		var b = BoundingBox.Empty;
		if (children == null) return b;
		foreach (var c in children)
		{
			if (c == null) continue;
			b = b.Union(c.ComputeBounds());
		}
		return b;
	}

	// ============================================================================
	// IElementVisitor
	// ============================================================================

	public void Visit(GroupElement element)
	{
		if (element == null) return;
		var hasTransform = !element.Transform.IsIdentity;

		XGraphicsState state = default;
		if (hasTransform)
		{
			state = _gfx.Save();
			_gfx.MultiplyTransform(ToXMatrix(element.Transform), XMatrixOrder.Prepend);
		}

		foreach (var child in element.Children) child?.Accept(this);

		if (hasTransform) _gfx.Restore(state);
	}

	public void Visit(PathElement element)
	{
		if (element == null) return;

		// Mirror legacy emission semantics: when both stroke and fill are null, draw a
		// black hairline. When fill is null but stroke is not, stroke only. When fill is
		// set, fill (and optionally stroke).
		var pen = element.Stroke != null ? CreatePen(element.Stroke) : null;
		var brush = element.Fill != null ? new XSolidBrush(ToXColor(element.Fill.Color, (float)element.Fill.Opacity)) : null;

		if (pen == null && brush == null)
		{
			// Legacy "unstyled curve" => fill='none' stroke='black' stroke-width unspecified.
			// PdfSharpCore needs an explicit width — mirror SvgRenderer's default Stroke width.
			pen = CreatePen(new Stroke { Color = Color.Black, Width = 0.25 });
		}

		if (brush != null)
		{
			// Fills (with or without stroke) need a single XGraphicsPath so multi-subpath
			// shapes with holes resolve correctly under the path's fill rule.
			var xpath = PdfPathBuilder.Build(element.Path);
			if (pen != null) _gfx.DrawPath(pen, brush, xpath);
			else _gfx.DrawPath(brush, xpath);
		}
		else
		{
			// Stroke-only: draw each subpath as its own XGraphicsPath. PdfSharpCore's
			// StartFigure() boundary inside a single path doesn't reliably prevent disjoint
			// figures from being stroked as one connected polyline, which manifests as
			// spurious diagonals (e.g. across cells of a Table border path).
			foreach (var sub in PdfPathBuilder.BuildSubpaths(element.Path))
				_gfx.DrawPath(pen, sub);
		}
	}

	public void Visit(TextElement element)
	{
		if (element == null || string.IsNullOrEmpty(element.Text)) return;

		var style = element.Style ?? new TextStyle();
		if (element.Background.HasValue)
			DrawTextBackground(element, style);

		DrawText(
			element.Text,
			element.Position,
			style,
			element.RotationDegrees,
			horizontalAnchor: style.HorizontalAnchor,
			verticalAnchor: VerticalAnchor.Middle); // SvgRenderer uses dominant-baseline=middle

		// Phase 9: capture clickable hyperlink rect. We use ComputeBounds() over MeasuredBounds
		// when available — falls back to FontMetrics-based bounds. Rotated text gets an
		// axis-aligned bounding box; tight rotation isn't supported by PDF /Link annotations
		// (which only carry a rect, not a quadpoints array).
		if (_pendingLinks != null && !string.IsNullOrEmpty(element.Hyperlink))
		{
			var bounds = element.ComputeBounds();
			if (!bounds.IsEmpty) _pendingLinks.Add((bounds, element.Hyperlink));
		}
	}

	public void Visit(TextBlockElement element)
	{
		// Phase 5 stub matching SvgRenderer: render as a single-line at the box's top-left.
		// Layout-aware wrapping ships in Phase 7 (TextFlow).
		if (element == null) return;
		var style = element.Style ?? new TextStyle();
		DrawText(
			element.Text ?? string.Empty,
			new Point2D(element.Box.MinX, element.Box.MaxY),
			style,
			rotationDegrees: 0,
			horizontalAnchor: TextAnchor.Left,
			verticalAnchor: VerticalAnchor.Middle);
	}

	public void Visit(ImageElement element)
	{
		// Phase 5 stub. Image embedding ships when title-block use cases land in Phase 8.
		_ = element;
	}

	public void Visit(DimensionElement element)
	{
		if (element == null) return;
		switch (element.Kind)
		{
			case DimensionKind.Linear: DrawLinearDimension(element); break;
			case DimensionKind.Angular: DrawAngularDimension(element); break;
		}
	}

	public void Visit(LeaderElement element)
	{
		if (element == null || element.Points.Count < 2) return;

		var stroke = element.Stroke ?? new Stroke();
		var pen = CreatePen(stroke);

		for (var i = 0; i < element.Points.Count - 1; i++)
		{
			var p0 = element.Points[i];
			var p1 = element.Points[i + 1];
			_gfx.DrawLine(pen, p0.X, p0.Y, p1.X, p1.Y);
		}

		if (element.Head == LeaderHead.Arrow && element.Points.Count >= 2)
		{
			var n = element.Points.Count;
			var tip = element.Points[n - 1];
			var prev = element.Points[n - 2];
			DrawArrowhead(pen, prev, tip, element.HeadSize > 0 ? element.HeadSize : 4.0);
		}

		if (!string.IsNullOrEmpty(element.Text))
		{
			var anchor = element.Points[element.Points.Count - 1];
			DrawText(
				element.Text,
				anchor,
				element.TextStyle ?? new TextStyle(),
				rotationDegrees: 0,
				horizontalAnchor: (element.TextStyle ?? new TextStyle()).HorizontalAnchor,
				verticalAnchor: VerticalAnchor.Middle);
		}
	}

	public void Visit(HatchElement element)
	{
		// Phase 5 stub. Pattern fills ship with the layout layer (Phase 7+).
		_ = element;
	}

	public void Visit(SymbolElement element)
	{
		if (element?.Definition == null) return;

		// Phase 10a: when the definition has an Id and a cached Form XObject, draw the
		// shared form rather than re-emitting children. PdfSharpCore reuses the underlying
		// PDF resource across DrawImage calls. Anonymous definitions (no Id) keep the
		// inline expansion that's been the behaviour since Phase 5.
		var def = element.Definition;
		if (!string.IsNullOrEmpty(def.Id)
			&& _symbolForms != null
			&& _symbolForms.TryGetValue(def.Id, out var cache))
		{
			XGraphicsState state = default;
			var hasOffset = element.Position.X != 0 || element.Position.Y != 0;
			var hasTransform = !element.Transform.IsIdentity;
			if (hasOffset || hasTransform)
			{
				state = _gfx.Save();
				if (hasOffset) _gfx.TranslateTransform(element.Position.X, element.Position.Y);
				if (hasTransform) _gfx.MultiplyTransform(ToXMatrix(element.Transform), XMatrixOrder.Prepend);
			}

			// The form's bottom-left in form-local coords corresponds to (bounds.MinX,
			// bounds.MinY) in symbol-local coords. We want the symbol's natural origin
			// (0,0) — i.e. the point a child at (0,0) would draw to under inline expansion
			// — to land at (Position.X + transform·0, Position.Y + transform·0). The
			// translate/transform above handles Position+transform; here we shift by
			// (bounds.MinX, bounds.MinY) so the form's bottom-left aligns with symbol-local
			// (bounds.MinX, bounds.MinY), preserving the same visual placement as inline.
			_gfx.DrawImage(cache.Form, cache.Bounds.MinX, cache.Bounds.MinY,
				cache.WidthMm, cache.HeightMm);

			if (hasOffset || hasTransform) _gfx.Restore(state);
			return;
		}

		// Inline-expand anonymous definitions.
		var hasOffsetInline = element.Position.X != 0 || element.Position.Y != 0;
		var hasTransformInline = !element.Transform.IsIdentity;

		XGraphicsState inlineState = default;
		if (hasOffsetInline || hasTransformInline)
		{
			inlineState = _gfx.Save();
			if (hasOffsetInline) _gfx.TranslateTransform(element.Position.X, element.Position.Y);
			if (hasTransformInline) _gfx.MultiplyTransform(ToXMatrix(element.Transform), XMatrixOrder.Prepend);
		}

		foreach (var child in element.Definition.Children) child?.Accept(this);

		if (hasOffsetInline || hasTransformInline) _gfx.Restore(inlineState);
	}

	// ============================================================================
	// Dimension drawing (mirrors SvgRenderer.AppendLinear/AngularDimensionBody)
	// ============================================================================

	private void DrawLinearDimension(DimensionElement element)
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
		var arrowSize = ts * style.ArrowSizeFactor;

		var sign = offset >= 0 ? 1 : -1;
		var absOffset = Math.Abs(offset);
		var fullExtLen = Math.Max(0.0, absOffset - extGap);
		var maxExtLen = style.ExtensionLengthFactor > 0
			? ts * style.ExtensionLengthFactor
			: fullExtLen;
		var extLen = Math.Min(fullExtLen, maxExtLen);
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
			? len.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)
			: element.Label;
		var textLift = style.TextPlacement == DimensionTextPlacement.BreakLine
			? 0.0
			: ts * style.TextLiftFactor;
		var midX = (dimA.X + dimB.X) * 0.5 + nx * textLift * sign;
		var midY = (dimA.Y + dimB.Y) * 0.5 + ny * textLift * sign;

		var angleDeg = Math.Atan2(uy, ux) * 180.0 / Math.PI;
		if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

		var pen = CreatePen(new Stroke { Color = style.Color, Width = style.StrokeWidth });

		// Extension lines.
		_gfx.DrawLine(pen, extStartA.X, extStartA.Y, extEndA.X, extEndA.Y);
		_gfx.DrawLine(pen, extStartB.X, extStartB.Y, extEndB.X, extEndB.Y);

		if (style.TextPlacement == DimensionTextPlacement.BreakLine)
		{
			var textWidth = FontMetrics.Measure(text, style.FontFamily, ts).Width;
			var textHalfWidth = textWidth * 0.5 + ts * style.TextSidePaddingFactor;
			var midWorldX = (dimA.X + dimB.X) * 0.5;
			var midWorldY = (dimA.Y + dimB.Y) * 0.5;
			var gapAx = midWorldX - ux * textHalfWidth;
			var gapAy = midWorldY - uy * textHalfWidth;
			var gapBx = midWorldX + ux * textHalfWidth;
			var gapBy = midWorldY + uy * textHalfWidth;

			DrawDimSegment(pen, dimA.X, dimA.Y, gapAx, gapAy, style.TickKind, flipArrows, arrowSize, startTick: true, endTick: false);
			DrawDimSegment(pen, gapBx, gapBy, dimB.X, dimB.Y, style.TickKind, flipArrows, arrowSize, startTick: false, endTick: true);
		}
		else
		{
			DrawDimSegment(pen, dimA.X, dimA.Y, dimB.X, dimB.Y, style.TickKind, flipArrows, arrowSize, startTick: true, endTick: true);
		}

		if (flipArrows && style.TickKind == DimensionTickKind.Arrow)
		{
			var stub = arrowSize * 1.5;
			var outAx = dimA.X - ux * stub;
			var outAy = dimA.Y - uy * stub;
			var outBx = dimB.X + ux * stub;
			var outBy = dimB.Y + uy * stub;
			_gfx.DrawLine(pen, outAx, outAy, dimA.X, dimA.Y);
			DrawArrowhead(pen, new Point2D(outAx, outAy), new Point2D(dimA.X, dimA.Y), arrowSize);
			_gfx.DrawLine(pen, outBx, outBy, dimB.X, dimB.Y);
			DrawArrowhead(pen, new Point2D(outBx, outBy), new Point2D(dimB.X, dimB.Y), arrowSize);
		}

		var textStyle = new TextStyle
		{
			FontFamily = style.FontFamily,
			FontSize = ts,
			Color = style.Color,
			HorizontalAnchor = TextAnchor.Center,
			VerticalAnchor = VerticalAnchor.Middle,
		};
		DrawText(text, new Point2D(midX, midY), textStyle, angleDeg, TextAnchor.Center, VerticalAnchor.Middle);
	}

	private void DrawAngularDimension(DimensionElement element)
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

		var radius = Math.Min(lenA, lenB) * 0.3;

		var uax = dax / lenA; var uay = day / lenA;
		var ubx = dbx / lenB; var uby = dby / lenB;

		var dot = uax * ubx + uay * uby;
		var cross = uax * uby - uay * ubx;
		var smallTheta = Math.Atan2(cross, dot);
		var absSmall = Math.Abs(smallTheta);
		if (absSmall < 1e-6) return;

		var theta = smallTheta;
		var absTheta = Math.Abs(theta);
		var sweepCcw = theta > 0;

		var ts = style.TextSize;
		var arrowSize = ts * style.ArrowSizeFactor;

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

		var arcLen = absTheta * radius;
		var flipArrows = style.AutoFlipArrows
			&& style.TickKind == DimensionTickKind.Arrow
			&& arcLen < arrowSize * 3.0;

		var pen = CreatePen(new Stroke { Color = style.Color, Width = style.StrokeWidth });

		// Build the arc as a Path so we reuse the SVG-arc-to-cubic flattener.
		var arcPath = new Selva.Drawing.Model.Geometry.Path.Builder()
			.MoveTo(arcStartX, arcStartY)
			.ArcTo(new Point2D(arcEndX, arcEndY), radius, radius, 0, absTheta > Math.PI, !sweepCcw)
			.Build();
		_gfx.DrawPath(pen, PdfPathBuilder.Build(arcPath));

		if (style.TickKind == DimensionTickKind.Arrow && !flipArrows)
		{
			// Tangent at start = perpendicular to radial vector, oriented along sweep.
			double tStartX, tStartY;
			if (sweepCcw) { tStartX = -uay; tStartY = uax; }
			else { tStartX = uay; tStartY = -uax; }
			DrawArrowhead(pen,
				new Point2D(arcStartX - tStartX * arrowSize, arcStartY - tStartY * arrowSize),
				new Point2D(arcStartX, arcStartY), arrowSize, towardStart: true);

			double tEndX, tEndY;
			if (sweepCcw) { tEndX = -uby; tEndY = ubx; }
			else { tEndX = uby; tEndY = -ubx; }
			DrawArrowhead(pen,
				new Point2D(arcEndX - tEndX * arrowSize, arcEndY - tEndY * arrowSize),
				new Point2D(arcEndX, arcEndY), arrowSize);
		}
		else if (flipArrows && style.TickKind == DimensionTickKind.Arrow)
		{
			var stub = arrowSize * 1.5;

			double tStartX, tStartY;
			if (sweepCcw) { tStartX = -uay; tStartY = uax; }
			else { tStartX = uay; tStartY = -uax; }
			var outStartX = arcStartX - tStartX * stub;
			var outStartY = arcStartY - tStartY * stub;
			_gfx.DrawLine(pen, outStartX, outStartY, arcStartX, arcStartY);
			DrawArrowhead(pen, new Point2D(outStartX, outStartY), new Point2D(arcStartX, arcStartY), arrowSize);

			double tEndX, tEndY;
			if (sweepCcw) { tEndX = -uby; tEndY = ubx; }
			else { tEndX = uby; tEndY = -ubx; }
			var outEndX = arcEndX + tEndX * stub;
			var outEndY = arcEndY + tEndY * stub;
			_gfx.DrawLine(pen, outEndX, outEndY, arcEndX, arcEndY);
			DrawArrowhead(pen, new Point2D(outEndX, outEndY), new Point2D(arcEndX, arcEndY), arrowSize);
		}

		var degrees = absTheta * 180.0 / Math.PI;
		var text = string.IsNullOrEmpty(element.Label)
			? degrees.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "°"
			: element.Label;

		var textLift = ts * style.TextLiftFactor;
		var textRadius = radius + textLift;
		var midX = vx + bisX * textRadius;
		var midY = vy + bisY * textRadius;

		var bisAngleDeg = Math.Atan2(bisY, bisX) * 180.0 / Math.PI;
		var tangentAngleDeg = bisAngleDeg - 90.0;
		if (tangentAngleDeg > 90 || tangentAngleDeg < -90) tangentAngleDeg += 180;

		var textStyle = new TextStyle
		{
			FontFamily = style.FontFamily,
			FontSize = ts,
			Color = style.Color,
			HorizontalAnchor = TextAnchor.Center,
			VerticalAnchor = VerticalAnchor.Middle,
		};
		DrawText(text, new Point2D(midX, midY), textStyle, tangentAngleDeg, TextAnchor.Center, VerticalAnchor.Middle);
	}

	private void DrawDimSegment(
		XPen pen,
		double x1, double y1, double x2, double y2,
		DimensionTickKind tickKind, bool flipArrows, double arrowSize,
		bool startTick, bool endTick)
	{
		_gfx.DrawLine(pen, x1, y1, x2, y2);

		if (tickKind == DimensionTickKind.Arrow && !flipArrows)
		{
			if (startTick) DrawArrowhead(pen, new Point2D(x2, y2), new Point2D(x1, y1), arrowSize);
			if (endTick) DrawArrowhead(pen, new Point2D(x1, y1), new Point2D(x2, y2), arrowSize);
		}
		else if (tickKind == DimensionTickKind.Tick)
		{
			if (startTick) DrawTickMark(pen, new Point2D(x1, y1), new Point2D(x2, y2), arrowSize * 0.5);
			if (endTick) DrawTickMark(pen, new Point2D(x2, y2), new Point2D(x1, y1), arrowSize * 0.5);
		}
	}

	private void DrawArrowhead(XPen pen, Point2D from, Point2D tip, double size, bool towardStart = false)
	{
		var dx = tip.X - from.X;
		var dy = tip.Y - from.Y;
		var len = Math.Sqrt(dx * dx + dy * dy);
		if (len < 1e-9) return;

		var ux = dx / len;
		var uy = dy / len;
		// The SVG marker is a filled triangle from the line into the tip — half-width ~ size/2.5
		// to roughly match the marker geometry "0,0 → 10,5 → 0,10".
		var halfW = size * 0.4;
		var baseX = tip.X - ux * size;
		var baseY = tip.Y - uy * size;
		var leftX = baseX - uy * halfW;
		var leftY = baseY + ux * halfW;
		var rightX = baseX + uy * halfW;
		var rightY = baseY - ux * halfW;

		var brush = pen.Brush ?? new XSolidBrush(pen.Color);
		var arrow = new XGraphicsPath();
		arrow.AddLine(tip.X, tip.Y, leftX, leftY);
		arrow.AddLine(leftX, leftY, rightX, rightY);
		arrow.AddLine(rightX, rightY, tip.X, tip.Y);
		arrow.CloseFigure();
		_gfx.DrawPath(brush, arrow);
	}

	private void DrawTickMark(XPen pen, Point2D at, Point2D toward, double halfSize)
	{
		var dx = toward.X - at.X;
		var dy = toward.Y - at.Y;
		var len = Math.Sqrt(dx * dx + dy * dy);
		if (len < 1e-9) return;
		var ux = dx / len;
		var uy = dy / len;
		// 45° tick across the dimension line, mirroring the SVG marker (M -3 3 L 3 -3).
		var tx = (ux - uy) * halfSize;
		var ty = (uy + ux) * halfSize;
		_gfx.DrawLine(pen, at.X - tx, at.Y - ty, at.X + tx, at.Y + ty);
	}

	// ============================================================================
	// Text drawing
	// ============================================================================

	// Draws the background rectangle for a TextElement. We match DrawText's transform
	// stack (translate → scale(1,-1) → rotate) so the rect rotates with the glyphs, then
	// derive the local-frame bounds the same way DrawText would for verticalAnchor=Middle:
	// baseline at yOffset, line spans yOffset-ascent .. yOffset+descent. SvgRenderer uses
	// dominant-baseline=middle which centers slightly differently, but the discrepancy is
	// well within typical padding values and matches how the PDF renderer already draws
	// the glyphs.
	private void DrawTextBackground(TextElement element, TextStyle style)
	{
		if (!element.Background.HasValue) return;
		var text = element.Text ?? string.Empty;
		if (text.Length == 0 || style.FontSize <= 0) return;

		var measured = FontMetrics.Measure(text, style.FontFamily, style.FontSize, style.Weight, style.Style);
		var width = measured.Width;
		var ascent = measured.Ascent;
		var descent = Math.Abs(measured.Descent);
		var lineHeightMultiplier = Math.Max(1.0, style.LineHeight);
		var extra = (ascent + descent) * (lineHeightMultiplier - 1.0) * 0.5;
		ascent += extra;
		descent += extra;

		double xOffset = 0;
		switch (style.HorizontalAnchor)
		{
			case TextAnchor.Center: xOffset = -width / 2.0; break;
			case TextAnchor.Right: xOffset = -width; break;
		}

		// Mirror DrawText's verticalAnchor=Middle baseline placement.
		var yBaseline = (ascent + descent) / 2.0;
		var yTop = yBaseline - ascent;
		var height = ascent + descent;

		var p = element.BackgroundPadding;
		if (p > 0)
		{
			xOffset -= p; yTop -= p;
			width += 2 * p; height += 2 * p;
		}
		var radius = Math.Max(0, element.BackgroundCornerRadius);

		var state = _gfx.Save();
		_gfx.TranslateTransform(element.Position.X, element.Position.Y);
		_gfx.ScaleTransform(1, -1);
		if (element.RotationDegrees != 0) _gfx.RotateTransform(-element.RotationDegrees);

		var brush = new XSolidBrush(ToXColor(element.Background.Value, 1f));
		if (radius > 0)
			_gfx.DrawRoundedRectangle(brush, xOffset, yTop, width, height, radius * 2, radius * 2);
		else
			_gfx.DrawRectangle(brush, xOffset, yTop, width, height);

		_gfx.Restore(state);
	}

	private void DrawText(
		string text, Point2D position, TextStyle style, double rotationDegrees,
		TextAnchor horizontalAnchor, VerticalAnchor verticalAnchor)
	{
		if (string.IsNullOrEmpty(text) || style.FontSize <= 0) return;

		var font = ResolveFont(style);

		// Place text in world space. The XGraphics root has Y-flipped, so a naive DrawString
		// would render mirrored glyphs; counter-flip locally around the anchor — matches
		// SvgRenderer's `translate(...) scale(1 -1) rotate(...)` pattern.
		var state = _gfx.Save();
		_gfx.TranslateTransform(position.X, position.Y);
		_gfx.ScaleTransform(1, -1);
		if (rotationDegrees != 0) _gfx.RotateTransform(-rotationDegrees);

		// Measure for anchor offsets — use FontMetrics so behaviour matches the SVG renderer.
		var measured = FontMetrics.Measure(text, style.FontFamily, style.FontSize, style.Weight, style.Style);

		double xOffset = 0;
		switch (horizontalAnchor)
		{
			case TextAnchor.Center: xOffset = -measured.Width / 2.0; break;
			case TextAnchor.Right: xOffset = -measured.Width; break;
		}

		// PdfSharpCore's DrawString places the *baseline* relative to the (x,y) when using
		// XStringFormats.BaseLineLeft. Vertical anchor mapping:
		//   Baseline → y=0 (default)
		//   Middle   → y=0 - midline shift (cap/2-ish)
		//   Top      → y=0 - ascent
		//   Bottom   → y=0 + descent
		// We use ascent/descent from FontMetrics so the result matches SVG's
		// dominant-baseline=middle when verticalAnchor=Middle.
		double yOffset = 0;
		switch (verticalAnchor)
		{
			case VerticalAnchor.Top: yOffset = measured.Ascent; break;
			case VerticalAnchor.Middle: yOffset = (measured.Ascent + measured.Descent) / 2.0; break;
			case VerticalAnchor.Bottom: yOffset = measured.Descent; break;
		}

		var brush = new XSolidBrush(ToXColor(style.Color, 1f));
		_gfx.DrawString(text, font, brush, xOffset, yOffset, XStringFormats.BaseLineLeft);

		_gfx.Restore(state);
	}

	private XFont ResolveFont(TextStyle style)
	{
		var pdfStyle = PdfFontStyle.Regular;
		if (style.Weight == FontWeight.Bold) pdfStyle |= PdfFontStyle.Bold;
		if (style.Style == ModelFontStyle.Italic) pdfStyle |= PdfFontStyle.Italic;
		var family = ExtractFirstFamily(style.FontFamily) ?? _options.FontFamily ?? "Inter";
		// Force Unicode encoding explicitly. PdfSharpCore's default-constructor path picks
		// up GlobalFontSettings, which leaves the encoding undefined and trips the cmap
		// lookup for our bundled Inter — every char would otherwise resolve to .notdef
		// (the "white text" bug).
		return new XFont(family, style.FontSize, pdfStyle, XPdfFontOptions.UnicodeDefault);
	}

	private static string ExtractFirstFamily(string fontFamily)
	{
		if (string.IsNullOrEmpty(fontFamily)) return null;
		var comma = fontFamily.IndexOf(',');
		var first = comma < 0 ? fontFamily : fontFamily.Substring(0, comma);
		return first.Trim().Trim('"', '\'');
	}

	// ============================================================================
	// Style → PdfSharpCore primitive helpers
	// ============================================================================

	private static XPen CreatePen(Stroke stroke)
	{
		var pen = new XPen(ToXColor(stroke.Color, (float)stroke.Opacity), stroke.Width);

		switch (stroke.Cap)
		{
			case StrokeCap.Round: pen.LineCap = XLineCap.Round; break;
			case StrokeCap.Square: pen.LineCap = XLineCap.Square; break;
			default: pen.LineCap = XLineCap.Flat; break;
		}
		switch (stroke.Join)
		{
			case StrokeJoin.Round: pen.LineJoin = XLineJoin.Round; break;
			case StrokeJoin.Bevel: pen.LineJoin = XLineJoin.Bevel; break;
			default: pen.LineJoin = XLineJoin.Miter; break;
		}
		pen.MiterLimit = stroke.MiterLimit;

		if (stroke.DashArray != null && stroke.DashArray.Count > 0)
		{
			var pattern = new double[stroke.DashArray.Count];
			for (var i = 0; i < pattern.Length; i++) pattern[i] = stroke.DashArray[i];
			pen.DashPattern = pattern;
			pen.DashOffset = stroke.DashOffset;
		}
		return pen;
	}

	private static XColor ToXColor(Color color, float opacityMultiplier)
	{
		switch (color.Space)
		{
			case ColorSpace.Cmyk:
				{
					var x = XColor.FromCmyk(color.C, color.M, color.Y, color.K);
					x.A = color.A * opacityMultiplier;
					x.ColorSpace = XColorSpace.Cmyk;
					return x;
				}
			case ColorSpace.Named:
				return ParseNamedColor(color.Name, color.A * opacityMultiplier);
			default:
				{
					var alpha = color.A * opacityMultiplier;
					return XColor.FromArgb(
						(int)Math.Round(Clamp01(alpha) * 255),
						(int)Math.Round(color.R * 255),
						(int)Math.Round(color.G * 255),
						(int)Math.Round(color.B * 255));
				}
		}
	}

	// Minimal CSS-named-color parsing — the model's Color.Named is mostly used for
	// "currentColor" and a handful of standard names. Unknown names fall back to black.
	private static readonly Dictionary<string, (byte R, byte G, byte B)> NamedColors =
		new Dictionary<string, (byte, byte, byte)>(StringComparer.OrdinalIgnoreCase)
		{
			["black"] = (0, 0, 0), ["white"] = (255, 255, 255),
			["red"] = (255, 0, 0), ["green"] = (0, 128, 0), ["blue"] = (0, 0, 255),
			["gray"] = (128, 128, 128), ["grey"] = (128, 128, 128),
			["yellow"] = (255, 255, 0), ["cyan"] = (0, 255, 255), ["magenta"] = (255, 0, 255),
			["currentColor"] = (0, 0, 0),
		};

	private static XColor ParseNamedColor(string name, float alpha)
	{
		if (!string.IsNullOrEmpty(name) && NamedColors.TryGetValue(name, out var rgb))
			return XColor.FromArgb((int)Math.Round(Clamp01(alpha) * 255), rgb.R, rgb.G, rgb.B);
		// Unknown name: fall back to opaque black; matches the SVG renderer's "currentColor"
		// hand-off (the consuming SVG context resolves it; PDF has no notion of currentColor).
		return XColor.FromArgb((int)Math.Round(Clamp01(alpha) * 255), 0, 0, 0);
	}

	private static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;

	private static XMatrix ToXMatrix(Transform t) => new XMatrix(t.A, t.B, t.C, t.D, t.E, t.F);
}
