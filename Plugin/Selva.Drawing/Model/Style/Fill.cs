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

	public bool Equals(Fill other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		return Color == other.Color
			&& Opacity == other.Opacity
			&& Rule == other.Rule
			&& Pattern == other.Pattern
			&& PatternScale == other.PatternScale
			&& PatternAngle == other.PatternAngle;
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
			return h;
		}
	}
}
