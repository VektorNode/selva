using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Model.Elements;

// Reusable symbol definition: a self-contained subtree that the renderer emits once
// (as SVG <symbol> / PDF Form XObject) and instances many times. Carrying the children
// directly in the definition lets bounds work without a separate symbol registry; the
// renderer dedupes on Definition.Id when emitting.
public sealed class SymbolDefinition
{
	public string Id { get; init; }
	public IReadOnlyList<DrawElement> Children { get; init; } = Array.Empty<DrawElement>();
	public BoundingBox? ViewBox { get; init; }
}

// Instance of a SymbolDefinition. Phase 10 wires the renderer-side dedupe; until then
// renderers can simply expand each instance inline.
public sealed class SymbolElement : DrawElement
{
	public SymbolDefinition Definition { get; init; }
	public Point2D Position { get; init; }
	public Transform Transform { get; init; } = Geometry.Transform.Identity;

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		if (Definition == null) return BoundingBox.Empty;

		var local = Definition.ViewBox ?? UnionChildren(Definition.Children);
		if (local.IsEmpty) return local;

		// Translate to position then apply local transform — same convention as GroupElement.
		var translated = new Geometry.BoundingBox(
			local.MinX + Position.X, local.MinY + Position.Y,
			local.MaxX + Position.X, local.MaxY + Position.Y);

		if (Transform.IsIdentity) return translated;

		var p1 = Transform.Apply(new Point2D(translated.MinX, translated.MinY));
		var p2 = Transform.Apply(new Point2D(translated.MaxX, translated.MinY));
		var p3 = Transform.Apply(new Point2D(translated.MaxX, translated.MaxY));
		var p4 = Transform.Apply(new Point2D(translated.MinX, translated.MaxY));
		return BoundingBox.FromPoint(p1).Union(p2).Union(p3).Union(p4);
	}

	private static BoundingBox UnionChildren(IReadOnlyList<DrawElement> children)
	{
		var b = BoundingBox.Empty;
		foreach (var c in children) b = b.Union(c.ComputeBounds());
		return b;
	}
}
