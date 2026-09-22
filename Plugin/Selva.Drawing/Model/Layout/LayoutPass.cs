using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Walks a Document/Page/element tree and replaces every LayoutElement with the primitive
// DrawElement it resolves to. Renderers call this automatically before drawing.
//
// Resolves outside-in: a Stack containing a Frame containing a TextFlow resolves the Stack
// first, so inner LayoutElements receive the rectangle the outer layout placed them in.
// `Resolve(element, context)` calls `element.Resolve` to get a primitive subtree, then
// recurses through that subtree in case it still contains unresolved LayoutElements.
public static class LayoutPass
{
	public static Document Resolve(Document document)
	{
		if (document == null) return null;
		var pages = new List<Page>(document.Pages.Count);
		foreach (var page in document.Pages) pages.Add(ResolvePage(page));
		return new Document
		{
			Metadata = document.Metadata,
			Pages = pages,
		};
	}

	public static Page ResolvePage(Page page)
	{
		if (page == null) return null;
		if (page.Content == null) return page;

		// Page rect minus margins, Y-up world coords, origin (0,0). Zero margins are valid
		// (full-bleed page); only a zero-size paper means "no page bounds".
		var available = PaperIsZero(page.Size)
			? BoundingBox.Empty
			: new BoundingBox(
				page.Margins.Left,
				page.Margins.Bottom,
				Math.Max(page.Margins.Left, page.Size.WidthMm - page.Margins.Right),
				Math.Max(page.Margins.Bottom, page.Size.HeightMm - page.Margins.Top));

		var resolved = Resolve(page.Content, new LayoutContext(available));
		if (ReferenceEquals(resolved, page.Content)) return page;

		return new Page
		{
			Title = page.Title,
			Size = page.Size,
			Margins = page.Margins,
			Content = resolved,
		};
	}

	// Returns the same instance when no LayoutElement is encountered, so scenes with no
	// layout primitives round-trip unchanged (keeps snapshot tests stable).
	public static DrawElement Resolve(DrawElement element, LayoutContext context)
	{
		if (element == null) return null;

		if (element is LayoutElement layout)
		{
			var primitive = layout.Resolve(context);
			return Resolve(primitive, context);
		}

		if (element is GroupElement group)
		{
			IReadOnlyList<DrawElement> originalChildren = group.Children;
			List<DrawElement> rewritten = null;
			for (var i = 0; i < originalChildren.Count; i++)
			{
				var child = originalChildren[i];
				var resolvedChild = Resolve(child, context);
				if (rewritten != null)
				{
					rewritten.Add(resolvedChild);
				}
				else if (!ReferenceEquals(resolvedChild, child))
				{
					rewritten = new List<DrawElement>(originalChildren.Count);
					for (var j = 0; j < i; j++) rewritten.Add(originalChildren[j]);
					rewritten.Add(resolvedChild);
				}
			}
			if (rewritten == null) return group;
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
		}

		return element;
	}

	private static bool PaperIsZero(PaperSize size) => size.WidthMm <= 0 || size.HeightMm <= 0;
}
