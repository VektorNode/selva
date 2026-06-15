using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Features.Drawing.Preview;
using Selva.Drawing.RhinoInterop;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateCurve : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateCurve()
        : base("Draw Curve", "DCrv",
            "Converts a Rhino curve to a drawing element",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.DrawCurve;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("33D854CA-A7E6-48C7-819C-0FA9E63B6B4F");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _preview.ClippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _preview.Clear();
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden) return;
        _preview.Render(args);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddCurveParameter("Curve", "C", "Input curve", GH_ParamAccess.item);
        pManager.AddParameter(new Param_PathStyle("Style", "S", "Path style (use Path Style component)", "Selva", "Elements", GH_ParamAccess.item));

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
        // Chord tolerance for tessellation, in model units — a fixed 0.01 gave meter-based
        // documents 100× coarser relative facets than mm-based ones.
        var tolerance = DrawingTolerance.FromActiveDoc();

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

            _preview.Add(element);
            DA.SetData(0, element);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating curve element: {e.Message}");
        }
    }
}
