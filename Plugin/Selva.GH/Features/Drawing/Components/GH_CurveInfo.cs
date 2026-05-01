using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CurveInfo : GH_Component
{
    public GH_CurveInfo()
        : base("Curve Info", "CrvI",
            "Inspects curve properties relevant to drawing conversion",
            "Selva", "Elements")
    {
    }

    protected override Bitmap Icon => Resources.CurveInfo;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("C69E7C31-4BC3-44AC-8D3D-2C0E698774B2");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddCurveParameter("Curve", "C", "Curve to inspect", GH_ParamAccess.item);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("Type", "T", "Curve type", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Is Closed", "IC", "Whether curve is closed", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Can Fill", "CF", "Whether curve can be used as a fill boundary", GH_ParamAccess.item);
        pManager.AddNumberParameter("Length", "L", "Curve length", GH_ParamAccess.item);
        pManager.AddRectangleParameter("Bounding Box", "BB", "Curve bounding box", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Curve curve = null;
        if (!DA.GetData(0, ref curve) || curve == null) return;

        var bbox = curve.GetBoundingBox(true);
        var rectangle = new Rectangle3d(Plane.WorldXY, bbox.Min, bbox.Max);

        DA.SetData(0, curve.GetType().Name);
        DA.SetData(1, curve.IsClosed);
        DA.SetData(2, curve.IsClosed || curve.IsPeriodic);
        DA.SetData(3, curve.GetLength());
        DA.SetData(4, rectangle);
    }
}
