using System;

namespace Selva.GH.Features.Drawing.Components;

// Tessellation/join tolerance for converting Rhino geometry to drawing paths, derived from
// the document's absolute tolerance so the facet density tracks the model's units instead
// of assuming millimetres. Clamped: pathological doc settings shouldn't produce millions of
// segments or visibly faceted curves.
public static class DrawingTolerance
{
    public static double FromActiveDoc()
    {
        var docTolerance = Rhino.RhinoDoc.ActiveDoc?.ModelAbsoluteTolerance ?? 0.01;
        return Math.Min(Math.Max(docTolerance, 1e-6), 1.0);
    }
}
