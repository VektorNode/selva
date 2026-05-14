using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// A Section is an unrendered description that flows into a Document. It carries the content
// to lay out plus optional per-section overrides for paper, margins, and chrome. It does not
// know its page numbers — the Document drives pagination and global token resolution so
// `{page}` / `{pages}` reflect counts across the whole document, not the section.
//
// Any field left null falls back to the Document-level default. Section-level header / footer
// override the Document-level chrome for that section's pages only; the rest of the document
// keeps its own header/footer.
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
