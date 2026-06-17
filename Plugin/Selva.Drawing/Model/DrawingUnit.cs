namespace Selva.Drawing.Model;

// The authoring unit a user types lengths in. The drawing model is always internally in
// millimetres (renderers convert mm → PDF points / SVG units at the boundary); this enum exists
// only at the input surface so imperial users can think in inches without the model changing.
// Convert at the GH boundary via ToMm before constructing any model type.
public enum DrawingUnit
{
	Millimeters = 0,
	Centimeters = 1,
	Inches = 2,
	Points = 3, // PostScript/PDF points: 72 per inch
}

public static class DrawingUnitExtensions
{
	// Millimetres per one unit.
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

	// Convert an authored value in this unit to internal millimetres.
	public static double ToMm(this DrawingUnit unit, double value) => value * unit.MmPerUnit();
}
