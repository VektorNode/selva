using System;

namespace Selva.Drawing.Model.Style;

public enum FillRule { EvenOdd, NonZero }

public enum HatchPattern
{
    None,       // solid fill
    Lines,      // parallel lines
    CrossHatch, // two sets of crossing lines
    Dots,       // grid of dots
    Brick,      // staggered horizontal lines
}

public sealed class Fill : IEquatable<Fill>
{
	public Color Color { get; init; } = Color.Black;
	public double Opacity { get; init; } = 1.0;
	public FillRule Rule { get; init; } = FillRule.EvenOdd;
	public HatchPattern Pattern { get; init; } = HatchPattern.None;
	// Scale multiplier applied to the pattern tile (1.0 = default size, 2.0 = twice as large)
	public double PatternScale { get; init; } = 1.0;
	// Rotation in degrees applied to the pattern tile
	public double PatternAngle { get; init; } = 0.0;

	// Explicit tile size in paper-space mm. Drafting standards specify poché spacing as a
	// measurement ("2 mm hatch"), not as a multiplier, so this is the direct way to say it.
	// 0 means "derive from PatternScale" (DefaultPatternTileMm x PatternScale), which is the
	// original behaviour and stays the default.
	public double PatternSpacingMm { get; init; } = 0.0;

	// Line weight for the pattern's linework, in paper-space mm. 0 means "renderer default"
	// (Stroke.HatchPatternWidthMm, scaled with the tile). Poché normally reads lighter than
	// the object line it sits inside, which needs a weight independent of the boundary stroke.
	public double PatternLineWidthMm { get; init; } = 0.0;

	// Tile size before PatternScale is applied. Both renderers derive their geometry from it.
	public const double DefaultPatternTileMm = 4.0;

	// Resolved tile size in mm: the explicit spacing when set, else the scaled default.
	public double ResolvedTileMm =>
		PatternSpacingMm > 0 ? PatternSpacingMm : DefaultPatternTileMm * PatternScale;

	public bool Equals(Fill other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		return Color == other.Color
			&& Opacity == other.Opacity
			&& Rule == other.Rule
			&& Pattern == other.Pattern
			&& PatternScale == other.PatternScale
			&& PatternAngle == other.PatternAngle
			&& PatternSpacingMm == other.PatternSpacingMm
			&& PatternLineWidthMm == other.PatternLineWidthMm;
	}

	public override bool Equals(object obj) => Equals(obj as Fill);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = Color.GetHashCode();
			h = (h * 397) ^ Opacity.GetHashCode();
			h = (h * 397) ^ (int)Rule;
			h = (h * 397) ^ (int)Pattern;
			h = (h * 397) ^ PatternScale.GetHashCode();
			h = (h * 397) ^ PatternAngle.GetHashCode();
			h = (h * 397) ^ PatternSpacingMm.GetHashCode();
			h = (h * 397) ^ PatternLineWidthMm.GetHashCode();
			return h;
		}
	}
}
