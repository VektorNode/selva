using System;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

// Multi-line text wrapped to a fixed-width box. Line breaking is the layout pass's job,
// not the renderer's — this element just draws already-wrapped text.
public sealed class TextBlockElement : DrawElement
{
	public string Text { get; init; } = string.Empty;
	public BoundingBox Box { get; init; }
	public TextStyle Style { get; init; } = new TextStyle();

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds() => Box;
}

