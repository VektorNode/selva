using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Phase 7: shared base for layout primitives (Stack, Grid, Frame, TextFlow, Table). Layout
// elements compose into primitive DrawElements (paths, text, groups) during a layout pass
// that runs before the renderer. The IElementVisitor surface is intentionally unaware of
// LayoutElement — Accept(visitor) throws so a missed layout pass surfaces immediately
// rather than silently producing empty output.
public abstract class LayoutElement : DrawElement
{
	public sealed override void Accept(IElementVisitor visitor)
	{
		throw new InvalidOperationException(
			$"{GetType().Name} is a layout element. Run LayoutPass.Resolve(Document) before rendering, " +
			"or ensure the page content was passed through a renderer that resolves layout automatically.");
	}

	// Resolve to a concrete DrawElement (typically a GroupElement of positioned children).
	// Implementations must be deterministic for a given context — the layout pass may call
	// Resolve once per render.
	public abstract DrawElement Resolve(LayoutContext context);

	// Default: bounds come from a single resolve in an unconstrained context. Subclasses
	// override when they can compute natural bounds without resolving.
	public override BoundingBox ComputeBounds()
		=> Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();
}
