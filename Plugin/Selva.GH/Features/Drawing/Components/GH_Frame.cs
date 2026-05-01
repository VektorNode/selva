using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: bordered/filled rectangle around a single child with optional
// padding. Useful for building title-block cells, callout boxes, or simply giving any
// element a uniform border + padding.
public class GH_Frame : GH_Component
{
    public GH_Frame()
        : base("Frame", "Frame",
            "Wraps a drawing element in a bordered, padded rectangle",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.Frame;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("B5D67E89-1A2B-4C3D-9E4F-5A6B7C8D9E0F");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Child", "C", "Drawing element to wrap", GH_ParamAccess.item);
        pManager.AddGenericParameter("Border", "B", "Stroke style for the border (leave empty for no border)", GH_ParamAccess.item);
        pManager.AddNumberParameter("Padding", "P", "Uniform padding in millimetres around the child", GH_ParamAccess.item, 0.0);
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the frame in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        DrawElement child = null;
        Stroke border = null;
        var padding = 0.0;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref child);
        DA.GetData(1, ref border);
        DA.GetData(2, ref padding);
        DA.GetData(3, ref origin);

        var frame = new Frame
        {
            Child = child,
            Border = border,
            Padding = Margins.Uniform(Math.Max(0, padding)),
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, frame);
    }
}
