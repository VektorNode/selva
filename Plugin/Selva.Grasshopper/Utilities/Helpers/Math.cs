using System;

namespace Selva.Grasshopper.Utilities.Helpers;

public static class MathExtensions
{
	public static double Clamp(this double value, double min, double max)
	{
		if (min > max) throw new ArgumentException("min must be less than or equal to max", nameof(min));

		if (double.IsNaN(value)) return value;

		if (value < min) return min;

		if (value > max) return max;

		return value;
	}
}
