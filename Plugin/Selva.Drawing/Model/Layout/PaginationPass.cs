using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Phase: pagination. Walks a single root element top-to-bottom, fitting it into successive
// pages of the given paper/margins. Layout elements that override TrySplit can break across
// pages (e.g. a tall vertical Stack splits between children); everything else is atomic.
//
// Forward-progress guarantee: if an element returns NothingFits when nothing has yet been
// placed on the page, we force-place it (oversize) so we never loop forever.
//
// Phase 8b (templates): an optional PageTemplate adds chrome (Header/Footer) drawn on every
// page with token substitution applied per-page. The header/footer reservations shrink the
// content rect that pagination feeds to TrySplit.
public static class PaginationPass
{
	public static IReadOnlyList<Page> Paginate(DrawElement content, PaperSize paper, Margins margins)
		=> Paginate(content, paper, margins, null);

	public static IReadOnlyList<Page> Paginate(DrawElement content, PaperSize paper, Margins margins, PageTemplate template)
	{
		template = template ?? new PageTemplate();

		var pageRect = ContentRect(paper, margins);

		// Resolve header/footer once — their geometry doesn't change between pages, only the
		// substituted text does. Token-substitution clones only TextElement/TextBlockElement
		// nodes that contain braces, which keeps per-page cost low.
		var resolvedHeader = ResolveLayout(template.Header);
		var resolvedFooter = ResolveLayout(template.Footer);

		var headerHeight = ResolveBandHeight(template.HeaderHeight, resolvedHeader);
		var footerHeight = ResolveBandHeight(template.FooterHeight, resolvedFooter);

		var contentRect = ShrinkVertical(pageRect, headerHeight, footerHeight);
		var availableHeight = contentRect.IsEmpty ? double.PositiveInfinity : contentRect.Height;

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
					// Nothing fit. Force-place to guarantee forward progress.
					rawContents.Add(split.Overflow);
					remaining = null;
				}
				else
				{
					rawContents.Add(null);
					remaining = null;
				}
			}
		}

		var totalPages = rawContents.Count;
		var headerRect = headerHeight > 0
			? new BoundingBox(pageRect.MinX, pageRect.MaxY - headerHeight, pageRect.MaxX, pageRect.MaxY)
			: BoundingBox.Empty;
		var footerRect = footerHeight > 0
			? new BoundingBox(pageRect.MinX, pageRect.MinY, pageRect.MaxX, pageRect.MinY + footerHeight)
			: BoundingBox.Empty;

		var now = DateTime.Now;
		var pages = new List<Page>(totalPages);

		for (var i = 0; i < totalPages; i++)
		{
			var resolver = new TokenResolver(i + 1, totalPages, template.Title, template.Tokens, now);

			var pageHeader = resolvedHeader != null ? resolver.ResolveTree(resolvedHeader) : null;
			var pageFooter = resolvedFooter != null ? resolver.ResolveTree(resolvedFooter) : null;

			var anchoredContent = AnchorTopLeft(rawContents[i], contentRect);
			var anchoredHeader = AnchorTopLeft(pageHeader, headerRect);
			var anchoredFooter = AnchorTopLeft(pageFooter, footerRect);

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

	private static SplitResult TrySplitElement(DrawElement element, double availableHeight, LayoutContext context)
	{
		if (element == null) return new SplitResult(null, null, 0);

		if (element is LayoutElement layout)
			return layout.TrySplit(availableHeight, context);

		var bounds = element.ComputeBounds();
		var height = bounds.IsEmpty ? 0 : bounds.Height;
		if (height <= availableHeight + 1e-6)
			return SplitResult.AllFits(element, height);
		return SplitResult.NothingFits(element);
	}

	private static BoundingBox ContentRect(PaperSize paper, Margins margins)
	{
		if (paper.WidthMm <= 0 || paper.HeightMm <= 0) return BoundingBox.Empty;
		var minX = margins.Left;
		var minY = margins.Bottom;
		var maxX = Math.Max(margins.Left, paper.WidthMm - margins.Right);
		var maxY = Math.Max(margins.Bottom, paper.HeightMm - margins.Top);
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

	private static DrawElement ResolveLayout(DrawElement element)
	{
		if (element == null) return null;
		if (element is LayoutElement layout)
			return layout.Resolve(new LayoutContext(BoundingBox.Empty));
		return element;
	}

	private static double ResolveBandHeight(double? explicitHeight, DrawElement resolved)
	{
		if (explicitHeight.HasValue) return Math.Max(0, explicitHeight.Value);
		if (resolved == null) return 0;
		var b = resolved.ComputeBounds();
		return b.IsEmpty ? 0 : b.Height;
	}

	private static DrawElement AnchorTopLeft(DrawElement element, BoundingBox available)
	{
		if (element == null) return null;
		var b = element.ComputeBounds();
		if (b.IsEmpty || available.IsEmpty) return element;

		var tx = available.MinX - b.MinX;
		var ty = available.MaxY - b.MaxY;
		if (Math.Abs(tx) < 1e-9 && Math.Abs(ty) < 1e-9) return element;

		return new GroupElement
		{
			Transform = Transform.Translate(tx, ty),
			Children = new[] { element },
		};
	}

	private static DrawElement ComposePage(DrawElement header, DrawElement content, DrawElement footer)
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
