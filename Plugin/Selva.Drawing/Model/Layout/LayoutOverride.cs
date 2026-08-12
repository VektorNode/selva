using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model.Layout;

// Optional bundle of layout overrides for paper, margins, and chrome. Same shape applies
// at both Section and Document scope:
//   - On a Section: null fields inherit the Document's value.
//   - On a Document: null fields fall back to the built-in defaults (A4, 10mm, Left, ...).
public sealed class LayoutOverride
{
    public PaperSize? PaperSize { get; init; }
    public Margins? Margins { get; init; }

    public DrawElement Header { get; init; }
    public DrawElement Footer { get; init; }

    public double? HeaderHeight { get; init; }
    public double? FooterHeight { get; init; }

    public HorizontalAlign? HeaderAlign { get; init; }
    public HorizontalAlign? FooterAlign { get; init; }

    public ChromePlacement? HeaderPlacement { get; init; }
    public ChromePlacement? FooterPlacement { get; init; }

    public double? HeaderEdgeOffset { get; init; }
    public double? FooterEdgeOffset { get; init; }
}
