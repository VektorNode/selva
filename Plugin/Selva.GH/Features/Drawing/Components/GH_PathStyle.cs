using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_PathStyle : GH_Component
{
    public GH_PathStyle()
        : base("Path Style", "PStyle",
            "Creates a stroke/fill style for SVG curves and surfaces",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("2049ED21-0C88-4F99-AD1B-2E6717C37B3F");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Stroke Color", "SC", "Stroke color", GH_ParamAccess.item, Color.Black);
        pManager.AddNumberParameter("Stroke Width", "SW", "Stroke width", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Stroke Opacity", "SO", "Stroke opacity (0-1)", GH_ParamAccess.item, 1.0);
        pManager.AddColourParameter("Fill Color", "FC", "Fill color (closed paths)", GH_ParamAccess.item, Color.Transparent);
        pManager.AddBooleanParameter("Fill", "F", "Enable fill", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Fill Opacity", "FO", "Fill opacity (0-1)", GH_ParamAccess.item, 1.0);
        pManager.AddBooleanParameter("Round Caps", "R", "Round line caps and joins", GH_ParamAccess.item, false);
        pManager.AddBooleanParameter("Non-Scaling Stroke", "NSS",
            "Stroke width stays constant in pixels regardless of zoom", GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Style", "S", "Path style", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var strokeColor = Color.Black;
        var strokeWidth = 1.0;
        var strokeOpacity = 1.0;
        var fillColor = Color.Transparent;
        var fill = false;
        var fillOpacity = 1.0;
        var roundCaps = false;
        var nonScaling = false;

        DA.GetData(0, ref strokeColor);
        DA.GetData(1, ref strokeWidth);
        DA.GetData(2, ref strokeOpacity);
        DA.GetData(3, ref fillColor);
        DA.GetData(4, ref fill);
        DA.GetData(5, ref fillOpacity);
        DA.GetData(6, ref roundCaps);
        DA.GetData(7, ref nonScaling);

        var style = new PathStyleData
        {
            StrokeColor = strokeColor,
            StrokeWidth = (float)strokeWidth,
            StrokeOpacity = (float)Clamp01(strokeOpacity),
            HasStroke = true,
            FillColor = fillColor,
            HasFill = fill,
            FillOpacity = (float)Clamp01(fillOpacity),
            StrokeCap = roundCaps ? SvgStrokeCap.Round : SvgStrokeCap.Butt,
            StrokeJoin = roundCaps ? SvgStrokeJoin.Round : SvgStrokeJoin.Miter,
            NonScalingStroke = nonScaling
        };

        DA.SetData(0, style);
    }

    private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;
}
