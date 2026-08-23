using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// An unrendered description that flows into a Document: content plus optional per-section
// overrides for paper, margins, and chrome. A Section doesn't know its page numbers — the
// Document drives pagination and token resolution so `{page}` / `{pages}` count across the
// whole document, not the section. Any field left null falls back to the Document-level default.
public sealed class Section
{
	public DrawElement Content { get; init; }
	public string Title { get; init; }

	public PaperSize? PaperSize { get; init; }
	public Margins? Margins { get; init; }

	public DrawElement Header { get; init; }
	public DrawElement Footer { get; init; }

	public double? HeaderHeight { get; init; }
	public double? FooterHeight { get; init; }

	// Per-section overrides for chrome alignment. Null inherits the document-level value.
	public HorizontalAlign? HeaderAlign { get; init; }
	public HorizontalAlign? FooterAlign { get; init; }

	// Per-section overrides for chrome placement. Null inherits the document-level value.
	public ChromePlacement? HeaderPlacement { get; init; }
	public ChromePlacement? FooterPlacement { get; init; }

	// Per-section overrides for the Edge-mode offset (mm from paper edge). Null inherits.
	public double? HeaderEdgeOffset { get; init; }
	public double? FooterEdgeOffset { get; init; }

	// When true, the entire section is placed on a single page even if its content overflows
	// the content rect. Useful for cover pages, summaries, or tables you don't want split.
	public bool KeepTogether { get; init; }
}
