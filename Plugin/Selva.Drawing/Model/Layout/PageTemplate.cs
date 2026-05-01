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

	// User-defined tokens. Built-in tokens win on a name collision.
	public IReadOnlyDictionary<string, string> Tokens { get; init; }
}
