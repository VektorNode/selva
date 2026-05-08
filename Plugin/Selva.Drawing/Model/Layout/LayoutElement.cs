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

	// Context-aware bounds. Layout primitives whose size depends on the parent (e.g. a
	// TextFlow that auto-wraps to the available width) override this to honour the
	// context. Default delegates to the unconstrained ComputeBounds for elements whose
	// size is independent of the parent.
	public virtual BoundingBox ComputeBounds(LayoutContext context) => ComputeBounds();

	// Pagination hook: try to fit this layout element into a vertical budget. Default is
	// atomic — resolve once, take it whole or leave it whole. Subclasses that can break
	// between children (Stack between items, Table between rows, TextFlow between lines)
	// override this to produce partial Fits + Overflow.
	public virtual SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		var resolved = Resolve(context);
		var bounds = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		var height = bounds.IsEmpty ? 0 : bounds.Height;
		if (height <= availableHeight + 1e-6)
			return SplitResult.AllFits(resolved, height);
		return SplitResult.NothingFits(resolved);
	}
}
