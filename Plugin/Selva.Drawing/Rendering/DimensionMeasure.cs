using System;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;

namespace Selva.Drawing.Rendering;

// Bounds for dimension elements, shared by both exporters' auto-fit so SVG and PDF
// crop identically. Includes extension-line overshoot and the lifted label position
// that ComputeBounds misses.
internal static class DimensionMeasure
{
	public static BoundingBox Measure(DimensionElement d)
	{
		var style = d.Style ?? new DimensionStyle();
		switch (d.Kind)
		{
			case DimensionKind.Linear: return MeasureLinear(d, style);
			case DimensionKind.Angular: return MeasureAngular(d, style);
			default: return d.ComputeBounds();
		}
	}

	private static BoundingBox MeasureLinear(DimensionElement element, DimensionStyle style)
	{
		var ax = element.A.X; var ay = element.A.Y;
		var bx = element.B.X; var by = element.B.Y;
		var offset = element.Offset;
		var dx = bx - ax; var dy = by - ay;
		var len = Math.Sqrt(dx * dx + dy * dy);
		if (len < 1e-9) return BoundingBox.Empty;

		var ux = dx / len; var uy = dy / len;
		var nx = -uy; var ny = ux;
		var ts = style.TextSize;
		var extOver = ts * style.ExtensionOvershootFactor;
		var sign = offset >= 0 ? 1 : -1;

		var extEndAx = ax + nx * (offset + extOver * sign);
		var extEndAy = ay + ny * (offset + extOver * sign);
		var extEndBx = bx + nx * (offset + extOver * sign);
		var extEndBy = by + ny * (offset + extOver * sign);
		var dimAx = ax + nx * offset;
		var dimAy = ay + ny * offset;
		var dimBx = bx + nx * offset;
		var dimBy = by + ny * offset;

		var b = BoundingBox.FromPoint(new Point2D(ax, ay));
		b = b.Union(new Point2D(bx, by));
		b = b.Union(new Point2D(extEndAx, extEndAy));
		b = b.Union(new Point2D(extEndBx, extEndBy));
		b = b.Union(new Point2D(dimAx, dimAy));
		b = b.Union(new Point2D(dimBx, dimBy));
		return b;
	}

	private static BoundingBox MeasureAngular(DimensionElement element, DimensionStyle style)
	{
		var vx = element.Vertex.X; var vy = element.Vertex.Y;
		var ax = element.A.X; var ay = element.A.Y;
		var bx = element.B.X; var by = element.B.Y;

		var dax = ax - vx; var day = ay - vy;
		var dbx = bx - vx; var dby = by - vy;
		var lenA = Math.Sqrt(dax * dax + day * day);
		var lenB = Math.Sqrt(dbx * dbx + dby * dby);
		if (lenA < 1e-9 || lenB < 1e-9) return BoundingBox.Empty;

		var radius = Math.Min(lenA, lenB) * 0.3;
		var uax = dax / lenA; var uay = day / lenA;
		var ubx = dbx / lenB; var uby = dby / lenB;

		var dot = uax * ubx + uay * uby;
		var cross = uax * uby - uay * ubx;
		var theta = Math.Atan2(cross, dot);
		if (Math.Abs(theta) < 1e-6) return BoundingBox.Empty;

		var arcStartX = vx + uax * radius;
		var arcStartY = vy + uay * radius;
		var arcEndX = vx + ubx * radius;
		var arcEndY = vy + uby * radius;

		var bisX = uax + ubx; var bisY = uay + uby;
		var bisLen = Math.Sqrt(bisX * bisX + bisY * bisY);
		var sweepCcw = theta > 0;
		if (bisLen < 1e-9)
		{
			bisX = sweepCcw ? -uay : uay;
			bisY = sweepCcw ? uax : -uax;
			bisLen = 1.0;
		}
		bisX /= bisLen; bisY /= bisLen;

		var ts = style.TextSize;
		var textRadius = radius + ts * style.TextLiftFactor;
		var midX = vx + bisX * textRadius;
		var midY = vy + bisY * textRadius;

		var b = BoundingBox.FromPoint(new Point2D(vx, vy));
		b = b.Union(new Point2D(arcStartX, arcStartY));
		b = b.Union(new Point2D(arcEndX, arcEndY));
		b = b.Union(new Point2D(midX, midY));

		// Sample points along the arc so bounds don't undershoot a wide sweep.
		const int samples = 8;
		for (var i = 1; i < samples; i++)
		{
			var u = i / (double)samples;
			var ang = Math.Atan2(uay, uax) + theta * u;
			b = b.Union(new Point2D(vx + Math.Cos(ang) * radius, vy + Math.Sin(ang) * radius));
		}
		return b;
	}
}
