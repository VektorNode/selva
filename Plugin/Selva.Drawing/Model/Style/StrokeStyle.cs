using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.Drawing.Model.Style;

public enum StrokeCap { Butt, Round, Square }
public enum StrokeJoin { Miter, Round, Bevel }

// Width, DashArray entries, and DashOffset are paper-space millimetres — DrawingView
// counter-scales them so a 0.25 mm stroke renders at 0.25 mm regardless of view scale.
// DashArray null or empty means solid; otherwise the on/off pattern repeats from each
// segment's origin.
//
// Width = 0 means "no stroke" — lets authors turn off an outline without nulling the whole
// Stroke (which also carries Color, dash, cap). PDF's `0 w` operator means "thinnest line
// the device can render", so it renders as a different-weight hairline on every machine;
// renderers must check IsVisible and skip the stroke rather than ever emit `0 w`.
public sealed class Stroke : IEquatable<Stroke>
{
	// Widths at or below this count as invisible: exact zero plus values too thin to render
	// predictably on any device, for the same reason `0 w` isn't safe to emit.
	public const double MinVisibleWidthMm = 0.01;

	// Width for a path with neither stroke nor fill. Must be explicit on both renderers:
	// PDF requires a width, SVG would otherwise fall back to its spec default of 1.0 mm —
	// leaving it implicit on either side reintroduces a 4x mismatch between them.
	public const double UnstyledPathWidthMm = LineWeight.Fine;

	// Default hatch/pattern linework weight — lighter than body weight so it reads as texture.
	public const double HatchWidthMm = LineWeight.ExtraFine;

	// Line width inside a generated hatch tile, before Fill.PatternScale. Heavier than
	// HatchWidthMm because short tile lines need it to hold together visually.
	public const double HatchPatternWidthMm = 0.3;

	public static bool IsVisibleWidth(double widthMm) => widthMm > MinVisibleWidthMm;

	public Color Color { get; init; } = Color.Black;
	public double Width { get; init; } = LineWeight.Fine;

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
