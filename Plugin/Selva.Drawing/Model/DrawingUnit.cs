namespace Selva.Drawing.Model;

// The unit a user types lengths in. The model is always internally millimetres; this enum
// exists only at the input surface, so convert via ToMm at the GH boundary before
// constructing any model type.
public enum DrawingUnit
{
	Millimeters = 0,
	Centimeters = 1,
	Inches = 2,
	Points = 3, // PostScript/PDF points: 72 per inch
}

public static class DrawingUnitExtensions
{
	public static double MmPerUnit(this DrawingUnit unit)
	{
		switch (unit)
		{
			case DrawingUnit.Centimeters: return 10.0;
			case DrawingUnit.Inches: return 25.4;
			case DrawingUnit.Points: return 25.4 / 72.0;
			default: return 1.0; // Millimeters
		}
	}

	public static double ToMm(this DrawingUnit unit, double value) => value * unit.MmPerUnit();
}
