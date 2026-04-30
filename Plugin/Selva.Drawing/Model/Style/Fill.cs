using System;

namespace Selva.Drawing.Model.Style;

public enum FillRule { EvenOdd, NonZero }

// Solid fill only at Phase 1; gradients/patterns slot in later as discriminated cases by
// adding a FillKind enum + extra payload fields. Keeping it a simple class for now keeps
// the renderer dispatch trivial.
public sealed class Fill : IEquatable<Fill>
{
	public Color Color { get; init; } = Color.Black;
	public double Opacity { get; init; } = 1.0;
	public FillRule Rule { get; init; } = FillRule.EvenOdd;

	public bool Equals(Fill other)
	{
		if (other is null) return false;
		if (ReferenceEquals(this, other)) return true;
		return Color == other.Color && Opacity == other.Opacity && Rule == other.Rule;
	}

	public override bool Equals(object obj) => Equals(obj as Fill);

	public override int GetHashCode()
	{
		unchecked
		{
			var h = Color.GetHashCode();
			h = (h * 397) ^ Opacity.GetHashCode();
			h = (h * 397) ^ (int)Rule;
			return h;
		}
	}
}
