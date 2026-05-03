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

	// User-defined tokens. Built-in tokens win on a name collision.
	public IReadOnlyDictionary<string, string> Tokens { get; init; }
}

public enum HorizontalAlign
{
	Left = 0,
	Center = 1,
	Right = 2,
}
