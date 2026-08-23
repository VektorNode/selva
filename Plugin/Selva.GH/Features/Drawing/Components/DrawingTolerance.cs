using System;

namespace Selva.GH.Features.Drawing.Components;

// Tessellation tolerance derived from the document's absolute tolerance, so facet density
// tracks the model's units instead of assuming millimetres. Clamped so a pathological doc
// setting can't blow up segment counts or produce visibly faceted curves.
public static class DrawingTolerance
{
    public static double FromActiveDoc()
    {
        var docTolerance = Rhino.RhinoDoc.ActiveDoc?.ModelAbsoluteTolerance ?? 0.01;
        return Math.Min(Math.Max(docTolerance, 1e-6), 1.0);
    }
}
