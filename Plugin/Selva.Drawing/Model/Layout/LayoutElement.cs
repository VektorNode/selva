using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Layout;

// Shared base for layout primitives (Stack, Grid, Frame, TextFlow, Table). These resolve
// into primitive DrawElements (paths, text, groups) during a layout pass that runs before
// the renderer. Accept(visitor) throws so a skipped layout pass surfaces as an exception
// instead of silently rendering nothing.
public abstract class LayoutElement : DrawElement
{
	public sealed override void Accept(IElementVisitor visitor)
	{
		throw new InvalidOperationException(
			$"{GetType().Name} is a layout element. Run LayoutPass.Resolve(Document) before rendering, " +
			"or ensure the page content was passed through a renderer that resolves layout automatically.");
	}

	// Must be deterministic for a given context: the layout pass may call this once per render.
	public abstract DrawElement Resolve(LayoutContext context);

	public override BoundingBox ComputeBounds()
		=> Resolve(new LayoutContext(BoundingBox.Empty)).ComputeBounds();

	// Override when size depends on the parent context (e.g. a TextFlow that wraps to the
	// available width). Default resolves unconstrained.
	public virtual BoundingBox ComputeBounds(LayoutContext context) => ComputeBounds();

	// Pagination hook: fit this element into a vertical budget. Default is atomic: resolve
	// once, take it whole or not at all. Elements that can break between children (Stack
	// between items, Table between rows, TextFlow between lines) override this instead.
	public virtual SplitResult TrySplit(double availableHeight, LayoutContext context)
	{
		var resolved = Resolve(context);
		var bounds = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		var height = bounds.IsEmpty ? 0 : bounds.Height;
		if (height <= availableHeight + 1e-6)
			return SplitResult.AllFits(resolved, height);
		return SplitResult.NothingFits(resolved);
	}

	// Fallback when TrySplit reports NothingFits on a fresh page: place the smallest leading
	// fragment, oversize if need be, so pagination keeps making progress. Fits is always
	// non-null and resolved; Overflow strictly shrinks toward null. Default places the whole
	// element; splittable containers override to shed only their head (first stack child,
	// header + first table row, first text line).
	public virtual SplitResult ForcePlace(double availableHeight, LayoutContext context)
	{
		var resolved = Resolve(context);
		var bounds = resolved?.ComputeBounds() ?? BoundingBox.Empty;
		return SplitResult.AllFits(resolved, bounds.IsEmpty ? 0 : bounds.Height);
	}
}
