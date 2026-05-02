using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: a vertical or horizontal stack of drawing elements with
// uniform spacing and a single cross-axis alignment. Outputs a layout element that the
// renderer resolves into positioned primitives at render time.
public class GH_Stack : GH_Component
{
    public GH_Stack()
        : base("Stack", "Stack",
            "Arranges drawing elements in a vertical or horizontal stack with spacing and alignment",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.Stack;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("3601FD36-C04E-4E66-A6F1-19A1A3DA301C");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Children", "C", "Drawing elements to arrange", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Orientation", "O", "0 = vertical, 1 = horizontal", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Spacing", "S", "Gap between children in millimetres", GH_ParamAccess.item, 0.0);
        pManager.AddIntegerParameter("Cross Align", "A", "Cross-axis alignment", GH_ParamAccess.item, 0);
        pManager.AddPointParameter("Origin", "P", "Bottom-left of the stack in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;

        if (pManager[1] is Param_Integer orient)
        {
            orient.AddNamedValue("Vertical", 0);
            orient.AddNamedValue("Horizontal", 1);
        }
        if (pManager[3] is Param_Integer align)
        {
            align.AddNamedValue("Start", 0);
            align.AddNamedValue("Center", 1);
            align.AddNamedValue("End", 2);
            align.AddNamedValue("Stretch", 3);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var children = new List<DrawElement>();
        var orientation = 0;
        var spacing = 0.0;
        var align = 0;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetDataList(0, children);
        DA.GetData(1, ref orientation);
        DA.GetData(2, ref spacing);
        DA.GetData(3, ref align);
        DA.GetData(4, ref origin);

        var filtered = children.FindAll(c => c != null);

        var stack = new Stack
        {
            Orientation = orientation == 1 ? StackOrientation.Horizontal : StackOrientation.Vertical,
            Spacing = Math.Max(0, spacing),
            CrossAlign = (CrossAlign)Math.Max(0, Math.Min(3, align)),
            Origin = new Point2D(origin.X, origin.Y),
            Children = filtered,
        };

        DA.SetData(0, stack);
    }
}
