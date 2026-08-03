using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model;

// One page of a Document: paper size, margins, and a single root content element. For
// multiple top-level children, use a GroupElement as the root.
public sealed class Page
{
	public PaperSize Size { get; init; } = PaperSize.A4;
	public Margins Margins { get; init; } = Margins.Uniform(10);
	public DrawElement Content { get; init; }
	public string Title { get; init; }
}
