using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Walks a single root element top-to-bottom, fitting it into successive pages of the given
// paper/margins. Layout elements that override TrySplit can break across pages (e.g. a tall
// vertical Stack splits between children); everything else is atomic.
//
// Forward-progress guarantee: if an element returns NothingFits when nothing has yet been
// placed on the page, we force-place it (oversize) so we never loop forever.
//
// Two entry points:
// - PaginateBody: returns raw page contents only, with no chrome composed and no token
//   resolution. Used by DocumentLayoutPass to paginate sections independently before doing
//   global token resolution with full document-wide page counts.
// - Paginate: the single-section convenience overload that resolves chrome + tokens itself.
//   Useful for tests and any caller that doesn't need cross-section page numbering.
public static class PaginationPass
{
	public static IReadOnlyList<Page> Paginate(DrawElement content, PaperSize paper, Margins margins)
		=> Paginate(content, paper, margins, null);

	public static IReadOnlyList<Page> Paginate(DrawElement content, PaperSize paper, Margins margins, PageTemplate template)
	{
		template = template ?? new PageTemplate();

		var bandWidth = BandWidth(paper, margins);
		var now = DateTime.Now;

		// Band heights must be measured from the SUBSTITUTED text, because substitution changes
		// length and layout is what wraps it — measuring "{title}" reserved 5.8 mm for a value
		// that needed 17.4 mm. But {page}/{pages} need the page count, which needs the band
		// heights: a cycle. Break it by measuring with a provisional resolver, paginating, then
		// re-measuring against the real page count and re-paginating if the reserve grew.
		// One correction is enough — the second measurement uses final page numbers, and a band
		// that only grows can't oscillate.
		var probe = new TokenResolver(1, 1, template.Title, null, template.Tokens, now);
		var bands = MeasureBands(template, bandWidth, probe);
		var body = PaginateBody(content, paper, margins, bands);

		var settled = new TokenResolver(body.RawContents.Count, body.RawContents.Count, template.Title, null, template.Tokens, now);
		var settledBands = MeasureBands(template, bandWidth, settled);
		if (settledBands.HeaderHeight > bands.HeaderHeight || settledBands.FooterHeight > bands.FooterHeight)
		{
			bands = settledBands;
			body = PaginateBody(content, paper, margins, bands);
		}

		var totalPages = body.RawContents.Count;
		var pages = new List<Page>(totalPages);

		for (var i = 0; i < totalPages; i++)
		{
			var resolver = new TokenResolver(i + 1, totalPages, template.Title, null, template.Tokens, now);

			// Chrome is re-resolved per page against its band rect (not the empty context used
			// for band-height measurement above) so star grids fill the band width and TextFlows
			// wrap to it. Tokens substitute after layout — band heights therefore reflect the
			// template text, which is close enough for typical {page}-style tokens.
			var pageHeader = ResolveChromeForPage(template.Header, body.HeaderRect, resolver);
			var pageFooter = ResolveChromeForPage(template.Footer, body.FooterRect, resolver);

			// Body text gets the same substitution so tokens work outside chrome too.
			var anchoredContent = AnchorTopLeft(resolver.ResolveTree(body.RawContents[i]), body.ContentRect);
			var anchoredHeader = AnchorChrome(pageHeader, body.HeaderRect, template.HeaderAlign);
			var anchoredFooter = AnchorChrome(pageFooter, body.FooterRect, template.FooterAlign, VerticalAnchor.Bottom);

			pages.Add(new Page
			{
				Size = paper,
				Margins = margins,
				Title = template.Title,
				Content = ComposePage(anchoredHeader, anchoredContent, anchoredFooter),
			});
		}

		return pages;
	}

	// Splits content into raw per-page contents using the given paper / margins / reserved
	// chrome bands. Caller is responsible for token resolution and chrome composition. Returns
	// the rectangles where the chrome and content should be anchored on each page.
	//
	// Legacy overload: bands are placed in Content mode (the body is shrunk by the header /
	// footer heights). New callers should use the BandConfig overload to opt into Margin or
	// Edge placement.
	public static SectionLayout PaginateBody(DrawElement content, PaperSize paper, Margins margins, double headerHeight, double footerHeight)
		=> PaginateBody(content, paper, margins, BandConfig.ContentMode(headerHeight, footerHeight), availableHeightOverride: null);

	internal static SectionLayout PaginateBody(DrawElement content, PaperSize paper, Margins margins, double headerHeight, double footerHeight, double? availableHeightOverride)
		=> PaginateBody(content, paper, margins, BandConfig.ContentMode(headerHeight, footerHeight), availableHeightOverride);

	public static SectionLayout PaginateBody(DrawElement content, PaperSize paper, Margins margins, BandConfig bands)
		=> PaginateBody(content, paper, margins, bands, availableHeightOverride: null);

	// Internal overload used by DocumentLayoutPass to force a section onto a single page
	// (KeepTogether) by passing double.PositiveInfinity as the available height.
	internal static SectionLayout PaginateBody(DrawElement content, PaperSize paper, Margins margins, BandConfig bands, double? availableHeightOverride)
	{
		var pageRect = ContentRect(paper, margins);

		// Content: band sits at the content rect edge, body shrinks by band height.
		// Edge: band sits at EdgeOffset from the paper edge, body shrinks by EdgeOffset + BandHeight
		//       from that edge (so the body never flows behind the band).
		// Margin: band floats in the margin gap outside the content rect — body is unaffected.
		var contentTopReserve = ContentReserve(bands.HeaderPlacement, bands.HeaderHeight, bands.HeaderEdgeOffset, margins.Top);
		var contentBottomReserve = ContentReserve(bands.FooterPlacement, bands.FooterHeight, bands.FooterEdgeOffset, margins.Bottom);
		var contentRect = ShrinkVertical(pageRect, contentTopReserve, contentBottomReserve);
		// An empty content rect means the bands have eaten the whole body, i.e. there is no room
		// at all — not "unlimited room". Reading it as +Infinity made everything report a fit,
		// so a page whose chrome overflowed silently emitted one oversized page with content
		// running off the sheet instead of paginating. Zero makes ForcePlace drive progress.
		var availableHeight = availableHeightOverride
			?? (contentRect.IsEmpty ? 0.0 : contentRect.Height);

		var rawContents = new List<DrawElement>();
		if (content == null)
		{
			rawContents.Add(null);
		}
		else
		{
			var remaining = content;
			var safety = 0;
			const int safetyLimit = 2000;

			while (remaining != null)
			{
				if (++safety > safetyLimit)
					throw new InvalidOperationException(
						$"PaginationPass exceeded {safetyLimit} pages — a layout element may be reporting overflow without making progress.");

				var ctx = new LayoutContext(contentRect);
				var split = TrySplitElement(remaining, availableHeight, ctx);

				if (split.Fits != null)
				{
					rawContents.Add(split.Fits);
					remaining = split.Overflow;
				}
				else if (split.Overflow != null)
				{
					// Nothing fits even on a fresh page. Force-place only the smallest leading
					// fragment (oversize) and keep paginating — dumping the whole remainder here
					// would cram every later element onto this page and silently stop.
					var forced = ForcePlaceElement(remaining, availableHeight, ctx);
					rawContents.Add(forced.Fits);
					remaining = forced.Overflow;
				}
				else
				{
					rawContents.Add(null);
					remaining = null;
				}
			}
		}

		var headerRect = ComputeHeaderRect(paper, margins, pageRect, bands);
		var footerRect = ComputeFooterRect(paper, margins, pageRect, bands);

		return new SectionLayout
		{
			RawContents = rawContents,
			PageRect = pageRect,
			ContentRect = contentRect,
			HeaderRect = headerRect,
			FooterRect = footerRect,
		};
	}

	// Header band sits at the top of the page. Its outer (top) edge depends on placement:
	//   Content → top of the page rect (just inside the top margin).
	//   Margin  → top edge of the paper minus the top margin's slack, i.e. flush against the
	//             top of the paper, with the band hanging into the margin space.
	//   Edge    → headerEdgeOffset mm from the top of the paper.
	// How much to shrink the content rect for a given chrome band:
	//   Content → band height (band sits at the content rect edge)
	//   Edge    → EdgeOffset + BandHeight measured from the paper edge, minus the margin that
	//             is already excluded from the content rect. Clamped to zero so a large margin
	//             that already covers the band doesn't produce a negative shrink.
	//   Margin  → the part of the band that does not fit in the margin gap. A band shorter than
	//             the margin is genuinely free — that is the point of Margin placement. A taller
	//             one has to eat into the body, because it is drawn flush against the paper edge
	//             and neither renderer clips it. Returning a flat 0 here let a 40 mm auto-measured
	//             header overprint 30 mm of body on the default config (Margin + auto height).
	//             This is Edge with an offset of 0, so it shares that arm.
	private static double ContentReserve(ChromePlacement placement, double bandHeight, double edgeOffset, double margin)
	{
		switch (placement)
		{
			case ChromePlacement.Content:
				return bandHeight;
			case ChromePlacement.Edge:
				return Math.Max(0, edgeOffset + bandHeight - margin);
			default:
				return Math.Max(0, bandHeight - margin);
		}
	}

	private static BoundingBox ComputeHeaderRect(PaperSize paper, Margins margins, BoundingBox pageRect, BandConfig bands)
	{
		if (bands.HeaderHeight <= 0 || pageRect.IsEmpty) return BoundingBox.Empty;

		double topY;
		switch (bands.HeaderPlacement)
		{
			case ChromePlacement.Content:
				topY = pageRect.MaxY;
				break;
			case ChromePlacement.Edge:
				topY = paper.HeightMm - Math.Max(0, bands.HeaderEdgeOffset);
				break;
			default: // Margin
				topY = paper.HeightMm;
				break;
		}
		var bottomY = topY - bands.HeaderHeight;
		return new BoundingBox(pageRect.MinX, bottomY, pageRect.MaxX, topY);
	}

	// Footer band sits at the bottom of the page. Mirrors the header rules:
	//   Content → bottom of the page rect (just inside the bottom margin).
	//   Margin  → flush against the bottom of the paper, hanging into the margin space.
	//   Edge    → footerEdgeOffset mm from the bottom of the paper.
	private static BoundingBox ComputeFooterRect(PaperSize paper, Margins margins, BoundingBox pageRect, BandConfig bands)
	{
		if (bands.FooterHeight <= 0 || pageRect.IsEmpty) return BoundingBox.Empty;

		double bottomY;
		switch (bands.FooterPlacement)
		{
			case ChromePlacement.Content:
				bottomY = pageRect.MinY;
				break;
			case ChromePlacement.Edge:
				bottomY = Math.Max(0, bands.FooterEdgeOffset);
				break;
			default: // Margin
				bottomY = 0;
				break;
		}
		var topY = bottomY + bands.FooterHeight;
		return new BoundingBox(pageRect.MinX, bottomY, pageRect.MaxX, topY);
	}

	private static SplitResult TrySplitElement(DrawElement element, double availableHeight, LayoutContext context)
	{
		if (element == null) return new SplitResult(null, null, 0);

		if (element is LayoutElement layout)
			return layout.TrySplit(availableHeight, context);

		// A GroupElement is a primitive, but it can still *contain* layout elements — a Page
		// branch holding several DrawingViews arrives exactly like this, since composing a
		// single branch wraps it in a Group rather than a Stack. Measuring the group without
		// resolving it first would size those views against no context at all, so they keep
		// their natural size and run off the sheet. Resolve through the group with the page
		// context so the views auto-fit to the content rect before they are measured.
		var measured = element is GroupElement ? LayoutPass.Resolve(element, context) : element;

		var bounds = measured.ComputeBounds();
		var height = bounds.IsEmpty ? 0 : bounds.Height;
		if (height <= availableHeight + 1e-6)
			return SplitResult.AllFits(measured, height);
		return SplitResult.NothingFits(measured);
	}

	private static SplitResult ForcePlaceElement(DrawElement element, double availableHeight, LayoutContext context)
	{
		if (element is LayoutElement layout)
			return layout.ForcePlace(availableHeight, context);
		// Same as TrySplitElement: resolve through a Group so any layout elements inside it
		// size against the page before being force-placed.
		if (element is GroupElement) element = LayoutPass.Resolve(element, context);
		// Primitives are atomic: place whole (oversize) and move on.
		var bounds = element.ComputeBounds();
		return SplitResult.AllFits(element, bounds.IsEmpty ? 0 : bounds.Height);
	}

	private static BoundingBox ContentRect(PaperSize paper, Margins margins)
	{
		if (paper.WidthMm <= 0 || paper.HeightMm <= 0) return BoundingBox.Empty;

		// Clamp margins at zero. A negative margin is not a bleed instruction — nothing
		// downstream crops to the paper, so it just moved the content rect (and both chrome
		// bands with it) off the sheet: -10 mm on A4 produced a page rect of -10..307 on a
		// 297 mm sheet, with the header sitting entirely past the paper edge.
		var left = Math.Max(0, margins.Left);
		var bottom = Math.Max(0, margins.Bottom);
		var minX = left;
		var minY = bottom;
		var maxX = Math.Max(left, paper.WidthMm - Math.Max(0, margins.Right));
		var maxY = Math.Max(bottom, paper.HeightMm - Math.Max(0, margins.Top));
		return new BoundingBox(minX, minY, maxX, maxY);
	}

	private static BoundingBox ShrinkVertical(BoundingBox rect, double top, double bottom)
	{
		if (rect.IsEmpty) return rect;
		var minY = rect.MinY + Math.Max(0, bottom);
		var maxY = rect.MaxY - Math.Max(0, top);
		if (maxY <= minY) return BoundingBox.Empty;
		return new BoundingBox(rect.MinX, minY, rect.MaxX, maxY);
	}

	// Fully resolve any LayoutElement subtree to primitives so ComputeBounds returns a real
	// height for band measurement. Walks GroupElements too — a GroupElement wrapping a Stack
	// would otherwise be returned untouched and its measured bounds would miss the Stack's
	// post-layout extent, which silently zeroes out the chrome band reservation.
	public static DrawElement ResolveLayout(DrawElement element)
		=> LayoutPass.Resolve(element, new LayoutContext(BoundingBox.Empty));

	// Band-width-aware variant for band-height measurement: the per-page chrome resolve wraps
	// text to the band width (ResolveChromeForPage), so the measurement must wrap to the same
	// width — an unconstrained measure sees one long line and reserves a band that's too short,
	// letting the wrapped header spill over the body.
	public static DrawElement ResolveLayout(DrawElement element, double bandWidth)
	{
		var ctx = bandWidth > 0 && !double.IsPositiveInfinity(bandWidth)
			? new LayoutContext(new BoundingBox(0, 0, bandWidth, double.PositiveInfinity))
			: new LayoutContext(BoundingBox.Empty);
		return LayoutPass.Resolve(element, ctx);
	}

	// Measure both chrome bands with this page's tokens already substituted, wrapped to the band
	// width. Explicit HeaderHeight/FooterHeight still win — ResolveBandHeight short-circuits on
	// them — so the measurement only costs anything on the auto-measure path.
	private static BandConfig MeasureBands(PageTemplate template, double bandWidth, TokenResolver resolver)
	{
		var header = ResolveLayout(resolver.ResolveTree(template.Header), bandWidth);
		var footer = ResolveLayout(resolver.ResolveTree(template.Footer), bandWidth);
		return new BandConfig
		{
			HeaderHeight = ResolveBandHeight(template.HeaderHeight, header),
			FooterHeight = ResolveBandHeight(template.FooterHeight, footer),
			HeaderPlacement = template.HeaderPlacement,
			FooterPlacement = template.FooterPlacement,
			HeaderEdgeOffset = template.HeaderEdgeOffset,
			FooterEdgeOffset = template.FooterEdgeOffset,
		};
	}

	// Horizontal extent of the chrome bands for a given paper/margins (bands span the page
	// rect's width in every placement mode). Infinite when the paper is degenerate.
	public static double BandWidth(PaperSize paper, Margins margins)
	{
		var rect = ContentRect(paper, margins);
		return rect.IsEmpty ? double.PositiveInfinity : rect.Width;
	}

	// Per-page chrome: substitute this page's tokens into the raw template FIRST, then resolve
	// the result against the band rect.
	//
	// Order matters and used to be the other way round. Layout is what performs line breaking
	// and measurement, so substituting afterwards meant a TextFlow wrapped the literal
	// "{title}" and the real value — however much longer — was never re-broken or re-measured.
	// A title token advanced 562 mm on a 210 mm sheet with no overflow reported, because the
	// bounds still described the stale wrap box.
	internal static DrawElement ResolveChromeForPage(DrawElement template, BoundingBox bandRect, TokenResolver resolver)
	{
		if (template == null) return null;
		var substituted = resolver.ResolveTree(template);
		return LayoutPass.Resolve(substituted, new LayoutContext(bandRect));
	}

	public static double ResolveBandHeight(double? explicitHeight, DrawElement resolved)
	{
		if (explicitHeight.HasValue) return Math.Max(0, explicitHeight.Value);
		if (resolved == null) return 0;
		var b = resolved.ComputeBounds();
		return b.IsEmpty ? 0 : b.Height;
	}

	internal static DrawElement AnchorTopLeft(DrawElement element, BoundingBox available)
		=> AnchorChrome(element, available, HorizontalAlign.Left);

	// Which edge of the band the content is pinned to when it doesn't fit the reserve. Content
	// that overruns then grows towards the middle of the sheet instead of off the edge.
	internal enum VerticalAnchor { Top, Bottom }

	internal static DrawElement AnchorChrome(DrawElement element, BoundingBox available, HorizontalAlign align)
		=> AnchorChrome(element, available, align, VerticalAnchor.Top);

	internal static DrawElement AnchorChrome(DrawElement element, BoundingBox available, HorizontalAlign align, VerticalAnchor vertical)
	{
		if (element == null) return null;
		var b = element.ComputeBounds();
		if (b.IsEmpty || available.IsEmpty) return element;

		double tx;
		switch (align)
		{
			case HorizontalAlign.Center:
				tx = available.MinX + (available.Width - b.Width) / 2.0 - b.MinX;
				break;
			case HorizontalAlign.Right:
				tx = available.MaxX - b.MaxX;
				break;
			default:
				tx = available.MinX - b.MinX;
				break;
		}

		// A footer pins its BOTTOM edge to the bottom of its band. Top-anchoring it meant an
		// oversize footer grew downward past the paper edge — an 8 mm reserve holding 30 mm of
		// content was placed 12 mm below the sheet and simply lost. Headers keep the top anchor
		// for the mirror-image reason.
		var ty = vertical == VerticalAnchor.Bottom
			? available.MinY - b.MinY
			: available.MaxY - b.MaxY;
		if (Math.Abs(tx) < 1e-9 && Math.Abs(ty) < 1e-9) return element;

		return new GroupElement
		{
			Transform = Transform.Translate(tx, ty),
			Children = new[] { element },
		};
	}

	internal static DrawElement ComposePage(DrawElement header, DrawElement content, DrawElement footer)
	{
		var parts = new List<DrawElement>(3);
		if (header != null) parts.Add(header);
		if (content != null) parts.Add(content);
		if (footer != null) parts.Add(footer);

		if (parts.Count == 0) return null;
		if (parts.Count == 1) return parts[0];
		return new GroupElement { Children = parts };
	}
}

// Result of paginating one section's body into raw page contents. Caller composes chrome and
// resolves tokens after concatenating SectionLayouts from all sections.
public sealed class SectionLayout
{
	public IReadOnlyList<DrawElement> RawContents { get; init; } = Array.Empty<DrawElement>();
	public BoundingBox PageRect { get; init; }
	public BoundingBox ContentRect { get; init; }
	public BoundingBox HeaderRect { get; init; }
	public BoundingBox FooterRect { get; init; }
}

// Bundles band heights, placement modes, and edge offsets so PaginateBody has a single,
// extensible parameter for chrome configuration.
public struct BandConfig
{
	public double HeaderHeight;
	public double FooterHeight;
	public ChromePlacement HeaderPlacement;
	public ChromePlacement FooterPlacement;
	public double HeaderEdgeOffset;
	public double FooterEdgeOffset;

	// Convenience for legacy callers that only know about heights and want the old behaviour.
	public static BandConfig ContentMode(double headerHeight, double footerHeight) => new BandConfig
	{
		HeaderHeight = headerHeight,
		FooterHeight = footerHeight,
		HeaderPlacement = ChromePlacement.Content,
		FooterPlacement = ChromePlacement.Content,
	};
}
