using System.Collections.Generic;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.RhinoInterop;
using DrawBox = Selva.Drawing.Model.Geometry.BoundingBox;

namespace Selva.GH.Features.Drawing.Preview;

// Shared preview accumulator for components that emit a single DrawElement per
// SolveInstance call. Accumulates across iterations of a tree input so the whole
// component shows in the Rhino viewport, not just the last branch.
internal sealed class ElementPreviewBuffer
{
    private readonly List<DrawElement> _elements = new List<DrawElement>();
    private BoundingBox _clippingBox = BoundingBox.Empty;

    public BoundingBox ClippingBox => _clippingBox;

    public void Clear()
    {
        _elements.Clear();
        _clippingBox = BoundingBox.Empty;
    }

    public void Add(DrawElement element)
    {
        if (element == null) return;
        _elements.Add(element);
        var bounds = element.ComputeBounds();
        if (!bounds.IsEmpty) _clippingBox = Union(_clippingBox, ToRhinoBox(bounds));
    }

    public void Render(IGH_PreviewArgs args)
    {
        if (_elements.Count == 0) return;
        var visitor = new RhinoViewportVisitor(args.Display);
        foreach (var element in _elements) visitor.Render(element);
    }

    private static BoundingBox ToRhinoBox(DrawBox b) =>
        new BoundingBox(new Point3d(b.MinX, b.MinY, 0), new Point3d(b.MaxX, b.MaxY, 0));

    private static BoundingBox Union(BoundingBox a, BoundingBox b)
    {
        if (!a.IsValid) return b;
        if (!b.IsValid) return a;
        a.Union(b);
        return a;
    }
}
