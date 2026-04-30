using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateCurve : GH_Component
{
    public GH_CreateCurve()
        : base("Draw Curve", "DCrv",
            "Converts a Rhino curve to a drawing element",
            "Selva", "Elements")
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
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Curve curve = null;
        PathStyle style = null;
        var tolerance = 0.01;

        if (!DA.GetData(0, ref curve) || curve == null) return;
        DA.GetData(1, ref style);

        try
        {
            var path = CurveConverter.ToPath(curve, tolerance);
            if (path == null || path.IsEmpty)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Curve produced no path data");
                return;
            }

            // When no style is connected, leave both Stroke and Fill null. The renderer's
            // PathElement visitor falls back to "fill='none' stroke='black'" in that case.
            var element = new PathElement
            {
                Path = path,
                Stroke = style?.Stroke,
                Fill = style?.Fill,
            };

            DA.SetData(0, element);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating curve element: {e.Message}");
        }
    }
}
