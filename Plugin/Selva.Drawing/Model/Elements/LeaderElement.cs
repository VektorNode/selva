using System;
using System.Collections.Generic;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;

namespace Selva.Drawing.Model.Elements;

public enum LeaderHead { Arrow, Dot, None }

// Pointer line + label. Points define the leader polyline (typically 2 or 3 vertices —
// arrow tip, optional knee, text anchor). The label is rendered as a TextElement-style
// run anchored at the last point.
public sealed class LeaderElement : DrawElement
{
	public IReadOnlyList<Point2D> Points { get; init; } = Array.Empty<Point2D>();
	public string Text { get; init; } = string.Empty;
	public TextStyle TextStyle { get; init; } = new TextStyle();
	public Stroke Stroke { get; init; } = new Stroke();
	public LeaderHead Head { get; init; } = LeaderHead.Arrow;
	public double HeadSize { get; init; } = 4.0;

	public override void Accept(IElementVisitor visitor)
	{
		if (visitor == null) throw new ArgumentNullException(nameof(visitor));
		visitor.Visit(this);
	}

	public override BoundingBox ComputeBounds()
	{
		var b = BoundingBox.Empty;
		foreach (var p in Points) b = b.Union(p);
		// Inflate a touch for the head and text — Phase 4 will give us real text metrics
		// to do this precisely.
		var pad = Math.Max(HeadSize, (TextStyle?.FontSize ?? 0) * (Text?.Length ?? 0) * 0.55);
		return b.IsEmpty ? b : b.Inflate(pad, (TextStyle?.FontSize ?? 0) * 0.6);
	}
}
