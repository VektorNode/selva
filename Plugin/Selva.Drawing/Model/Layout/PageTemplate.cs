using System.Collections.Generic;
using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Phase 8: chrome that wraps every page emitted by PaginationPass. Header and Footer are
// drawn once per page (with token substitution applied) and the content rect is shrunk by
// HeaderHeight / FooterHeight to make room for them.
//
// HeaderHeight / FooterHeight are explicit reservations. When null, the pass measures
// ComputeBounds().Height on the resolved subtree. Use the explicit form for headers whose
// content varies per page (token expansions can change line widths but not heights — yet).
public sealed class PageTemplate
{
	public string Title { get; init; }

	public DrawElement Header { get; init; }
	public DrawElement Footer { get; init; }

	public double? HeaderHeight { get; init; }
	public double? FooterHeight { get; init; }

	// Horizontal alignment of header/footer within their band. Defaults to Left for backwards
	// compatibility with the original anchor-top-left behaviour.
	public HorizontalAlign HeaderAlign { get; init; } = HorizontalAlign.Left;
	public HorizontalAlign FooterAlign { get; init; } = HorizontalAlign.Left;

	// Where the chrome bands live relative to the page margin. Defaults to Margin: the body
	// fills the full content rect and the chrome floats in the margin space outside it (this
	// matches Word / InDesign / CSS @page).
	public ChromePlacement HeaderPlacement { get; init; } = ChromePlacement.Margin;
	public ChromePlacement FooterPlacement { get; init; } = ChromePlacement.Margin;

	// Distance from the paper edge to the chrome band when placement is Edge. Ignored for
	// Margin / Content placements.
	public double HeaderEdgeOffset { get; init; }
	public double FooterEdgeOffset { get; init; }

	// User-defined tokens. Built-in tokens win on a name collision.
	public IReadOnlyDictionary<string, string> Tokens { get; init; }
}

public enum HorizontalAlign
{
	Left = 0,
	Center = 1,
	Right = 2,
}

// Where a header / footer band lives on the page.
//
// - Margin: the band sits in the page margin (between the content rect and the paper edge).
//   The body fills the full content rect, unaffected by the band's height. Default.
// - Content: the band reserves space inside the content rect, shrinking the body accordingly.
//   Use when the body needs to flow above/below the chrome rather than overlap with margin
//   space.
// - Edge: the band is anchored a fixed distance from the paper edge, ignoring margins. Pair
//   with HeaderEdgeOffset / FooterEdgeOffset (mm from paper edge to the outer side of the
//   band).
public enum ChromePlacement
{
	Margin = 0,
	Content = 1,
	Edge = 2,
}
