using Rhino;

namespace Selva.GH.Features.Display.Services;

public static class DisplayUnits
{
    // The name the wire's `modelUnits` and a mesh file's recorded units use.
    public static string ActiveDocModelUnits()
    {
        return RhinoDoc.ActiveDoc?.ModelUnitSystem.ToString() ?? "Meters";
    }

    // Falls back to metres with no active document, not mm like DrawingUnits: metres is the
    // encoder's pre-unit-aware behaviour, and assuming mm would push big headless jobs to float32.
    public static double ActiveDocMetersPerUnit()
    {
        var doc = RhinoDoc.ActiveDoc;
        if (doc == null) return 1.0;
        var scale = RhinoMath.UnitScale(doc.ModelUnitSystem, UnitSystem.Meters);
        return scale > 0 && !double.IsInfinity(scale) ? scale : 1.0;
    }
}
