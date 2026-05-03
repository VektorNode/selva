using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Drawing.Model.Style;

public enum StrokeCap { Butt, Round, Square }
public enum StrokeJoin { Miter, Round, Bevel }

// Line-drawing style. Width, DashArray entries, and DashOffset are all paper-space
// millimetres — DrawingView counter-scales them so a 0.25 mm stroke renders at 0.25 mm on
// paper regardless of the view's scale. DashArray of null means a solid line; an empty
// array also means solid; non-empty values repeat the on/off pattern starting from each
// segment's origin.
public sealed class Stroke : IEquatable<Stroke>
{
	public Color Color { get; init; } = Color.Black;
	public double Width { get; init; } = 0.25;
	public double Opacity { get; init; } = 1.0;
	public StrokeCap Cap { get; init; } = StrokeCap.Butt;
	public StrokeJoin Join { get; init; } = StrokeJoin.Miter;
	public double MiterLimit { get; init; } = 4.0;
	public IReadOnlyList<double> DashArray { get; init; }
	public double DashOffset { get; init; }

	public bool Equals(Stroke other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		return Color == other.Color
			&& Width == other.Width
			&& Opacity == other.Opacity
			&& Cap == other.Cap
			&& Join == other.Join
			&& MiterLimit == other.MiterLimit
			&& DashOffset == other.DashOffset
			&& DashesEqual(DashArray, other.DashArray);
	}

	private static bool DashesEqual(IReadOnlyList<double> a, IReadOnlyList<double> b)
	{
		if (ReferenceEquals(a, b)) return true;
		if (a == null || b == null) return (a == null || a.Count == 0) && (b == null || b.Count == 0);
		if (a.Count != b.Count) return false;
		for (var i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
		return true;
	}

	public override bool Equals(object obj) => Equals(obj as Stroke);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = Color.GetHashCode();
			h = (h * 397) ^ Width.GetHashCode();
			h = (h * 397) ^ Opacity.GetHashCode();
			h = (h * 397) ^ (int)Cap;
			h = (h * 397) ^ (int)Join;
			h = (h * 397) ^ MiterLimit.GetHashCode();
			h = (h * 397) ^ DashOffset.GetHashCode();
			if (DashArray != null) foreach (var d in DashArray) h = (h * 397) ^ d.GetHashCode();
			return h;
		}
	}
}
