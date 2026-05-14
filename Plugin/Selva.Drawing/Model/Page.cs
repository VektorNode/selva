using Selva.Drawing.Model.Elements;

namespace Selva.Drawing.Model;

// One page of a Document: paper size, margins, and a single root content element. Use a
// GroupElement when you need multiple children at the top level (its collection-init
// support makes that ergonomic).
public sealed class Page
{
	public PaperSize Size { get; init; } = PaperSize.A4;
	public Margins Margins { get; init; } = Margins.Uniform(10);
	public DrawElement Content { get; init; }
	public string Title { get; init; }
}
