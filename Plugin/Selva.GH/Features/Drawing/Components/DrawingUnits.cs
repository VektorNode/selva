using Rhino;
using Selva.Drawing.Model;

namespace Selva.GH.Features.Drawing.Components;

// Maps a GH Units dropdown index to millimetres-per-unit. Index 0 ("Auto") reads the active
// Rhino document's model unit, so "20" means 20 of whatever the user models in. Explicit
// indices override that. The drawing model is always internally mm; this only governs how
// authored lengths (margins, view Length/Padding, …) are interpreted.
public static class DrawingUnits
{
    public const int Auto = 0;
    public const int Millimeters = 1;
    public const int Centimeters = 2;
    public const int Inches = 3;
    public const int Points = 4;

    public static void AddNamedValues(Grasshopper.Kernel.Parameters.Param_Integer param)
    {
        param.AddNamedValue("Auto (Rhino doc)", Auto);
        param.AddNamedValue("Millimeters", Millimeters);
        param.AddNamedValue("Centimeters", Centimeters);
        param.AddNamedValue("Inches", Inches);
        param.AddNamedValue("Points", Points);
    }

    public static double MmPerUnit(int index)
    {
        switch (index)
        {
            case Millimeters: return DrawingUnit.Millimeters.MmPerUnit();
            case Centimeters: return DrawingUnit.Centimeters.MmPerUnit();
            case Inches: return DrawingUnit.Inches.MmPerUnit();
            case Points: return DrawingUnit.Points.MmPerUnit();
            default: return ActiveDocMmPerUnit(); // Auto
        }
    }

    public static double ToMm(int index, double value) => value * MmPerUnit(index);

    // Falls back to 1 (mm) when there's no active document (headless) or the unit is unset.
    public static double ActiveDocMmPerUnit()
    {
        var doc = RhinoDoc.ActiveDoc;
        if (doc == null) return 1.0;
        var scale = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Millimeters);
        return scale > 0 ? scale : 1.0;
    }
}
