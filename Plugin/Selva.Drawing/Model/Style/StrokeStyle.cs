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
//
// Width = 0 means "no stroke": the path is not stroked at all, in either renderer. It is the
// authoring-side way to turn an outline off without having to null out the whole Stroke, which
// matters because a Stroke also carries Color, dash, and cap settings worth keeping around.
//
// A zero must never reach the output as a literal width. PDF's `0 w` operator is defined as
// "thinnest line the *device* can render", so it draws a hairline whose weight depends on the
// printer, viewer, and DPI — the same file looked different on every machine. Renderers
// therefore branch on IsVisible and skip the stroke entirely rather than emitting `0 w`.
// Sub-threshold widths are treated the same way: too thin to render predictably anywhere.
public sealed class Stroke : IEquatable<Stroke>
{
	// Widths at or below this count as "no stroke". Covers exact zero plus the sliver of
	// values too thin for any real output device, which land inconsistently for the same
	// reason `0 w` does.
	public const double MinVisibleWidthMm = 0.01;

	// Width used when a path carries no stroke and no fill at all. Both renderers must agree
	// on this: PDF has to name a width explicitly, while SVG would otherwise fall through to
	// the spec default of 1.0 mm, so leaving it implicit on either side reintroduces the 4x
	// mismatch this constant exists to prevent.
	public const double UnstyledPathWidthMm = LineWeight.Fine;

	// Default weight for hatch and pattern linework, which sits below the body weight so it
	// reads as texture rather than as geometry.
	public const double HatchWidthMm = LineWeight.ExtraFine;

	// Line width inside a generated hatch tile, before Fill.PatternScale is applied. Slightly
	// heavier than HatchWidthMm because tile lines are short and need to hold together
	// visually. Both renderers read this; it used to be an independent 0.3 literal in the PDF
	// renderer and seven more in the SVG one.
	public const double HatchPatternWidthMm = 0.3;

	// Whether a width produces a drawn line at all. Renderers must check this before stroking:
	// emitting a zero-width stroke is what made output device-dependent.
	public static bool IsVisibleWidth(double widthMm) => widthMm > MinVisibleWidthMm;

	public Color Color { get; init; } = Color.Black;
	public double Width { get; init; } = LineWeight.Fine;

	// Whether this stroke draws anything. False means the path is left unstroked.
	public bool IsVisible => IsVisibleWidth(Width);
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
