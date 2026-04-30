namespace Selva.Drawing.Model.Elements;

// Renderers (SVG, PDF, future targets) implement this. Layout elements (Stack, Grid,
// Frame, Table, TextFlow) are intentionally NOT in the visitor — those decompose into
// the primitives below during a layout pass before the renderer runs.
public interface IElementVisitor
{
	void Visit(PathElement element);
	void Visit(TextElement element);
	void Visit(TextBlockElement element);
	void Visit(ImageElement element);
	void Visit(GroupElement element);
	void Visit(DimensionElement element);
	void Visit(LeaderElement element);
	void Visit(HatchElement element);
	void Visit(SymbolElement element);
}
