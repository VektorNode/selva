using System.Collections.Generic;
using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Chrome that wraps every page emitted by PaginationPass. Header and Footer are drawn once
// per page (with token substitution applied) and the content rect shrinks by HeaderHeight /
// FooterHeight to make room for them.
//
// HeaderHeight / FooterHeight are explicit reservations; when null, the pass measures
// ComputeBounds().Height on the resolved subtree instead. Set them explicitly for headers
// whose content varies per page: token expansion can change line widths but not heights.
public sealed class PageTemplate
{
	public string Title { get; init; }

	public DrawElement Header { get; init; }
	public DrawElement Footer { get; init; }

	public double? HeaderHeight { get; init; }
	public double? FooterHeight { get; init; }

	public HorizontalAlign HeaderAlign { get; init; } = HorizontalAlign.Left;
	public HorizontalAlign FooterAlign { get; init; } = HorizontalAlign.Left;

	// Defaults to Margin: the body fills the full content rect and the chrome floats in the
	// margin space outside it, matching Word / InDesign / CSS @page.
	public ChromePlacement HeaderPlacement { get; init; } = ChromePlacement.Margin;
	public ChromePlacement FooterPlacement { get; init; } = ChromePlacement.Margin;

	// Distance from the paper edge to the band; only used when placement is Edge.
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
// - Margin: sits in the page margin, between the content rect and the paper edge. Body
//   fills the full content rect, unaffected by the band's height. Default.
// - Content: reserves space inside the content rect, shrinking the body accordingly. Use
//   when the body needs to flow above/below the chrome instead of overlapping margin space.
// - Edge: anchored a fixed distance from the paper edge, ignoring margins. Pair with
//   HeaderEdgeOffset / FooterEdgeOffset (mm from paper edge to the band's outer side).
public enum ChromePlacement
{
	Margin = 0,
	Content = 1,
	Edge = 2,
}
