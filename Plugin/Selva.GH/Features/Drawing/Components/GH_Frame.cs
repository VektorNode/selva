using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Bordered/filled rectangle around a single child, with optional padding — title-block cells,
// callout boxes, or just giving an element a uniform border.
public class GH_Frame : GH_Component
{
    public GH_Frame()
        : base("Frame", "Frame",
            "Wraps a drawing element in a bordered, padded rectangle",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.Frame;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("B85A48FD-46DC-4A94-AD44-64B048237DBE");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element to wrap", GH_ParamAccess.item);
        pManager.AddParameter(new Param_Stroke("Border", "B", "Border stroke (use Path Style component; leave empty for no border)", "Selva", "Layout", GH_ParamAccess.item));
        pManager.AddNumberParameter("Padding", "P", "Uniform padding in millimetres around the child", GH_ParamAccess.item, 0.0);
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the frame in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
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
