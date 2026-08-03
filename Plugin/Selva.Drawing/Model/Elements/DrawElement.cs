using System.Collections.Generic;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Elements;

// Base for everything renderers know how to draw. Cross-cutting metadata lives here so
// every element gets it for free.
public abstract class DrawElement
{
	public string Id { get; init; }
	public string CssClass { get; init; }
	public IReadOnlyDictionary<string, string> Metadata { get; init; }

	public abstract void Accept(IElementVisitor visitor);
	public abstract BoundingBox ComputeBounds();
}
