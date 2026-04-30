using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateSvgCurve : GH_Component
{
    public GH_CreateSvgCurve()
        : base("Create SVG Curve", "CSC",
            "Converts a Rhino curve to SVG-ready data",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("4C2E8F3A-1B5D-4A9C-9E2F-7D8A1B4C5E6F");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddCurveParameter("Curve", "C", "Input curve", GH_ParamAccess.item);
        pManager.AddGenericParameter("Style", "S", "Path style", GH_ParamAccess.item);

        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Curve", "SC", "SVG curve data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Curve curve = null;
        PathStyleData style = null;
        var tolerance = 0.01;

        if (!DA.GetData(0, ref curve) || curve == null) return;
        DA.GetData(1, ref style);

        try
        {
            var pathData = CurveConverter.ToSvgPathData(curve, tolerance);
            if (string.IsNullOrEmpty(pathData))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Curve produced no path data");
                return;
            }

            var bb = curve.GetBoundingBox(true);
            var svgCurve = new SvgCurveData
            {
                PathData = pathData,
                Bounds = new SvgBounds(bb.Min.X, bb.Min.Y, bb.Max.X, bb.Max.Y),
                Style = style ?? new PathStyleData()
            };

            DA.SetData(0, svgCurve);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating SVG curve: {e.Message}");
        }
    }
}
