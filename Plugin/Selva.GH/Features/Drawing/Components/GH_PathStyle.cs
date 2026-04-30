using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing;

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
        pManager.AddIntegerParameter("Line Cap", "LC", "Stroke line cap shape", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Line Join", "LJ", "Stroke line join shape", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Dash Pattern", "DP", "Stroke dash pattern (e.g. 5 2 1 2 maps to stroke-dasharray)", GH_ParamAccess.list);
        pManager.AddBooleanParameter("Non-Scaling Stroke", "NSS",
            "Stroke width stays constant in pixels regardless of zoom", GH_ParamAccess.item, false);
        pManager.AddIntegerParameter("Fill Rule", "FR", "Fill rule for self-intersecting paths", GH_ParamAccess.item, 0);

        pManager[8].Optional = true;
        pManager[10].Optional = true;

        if (pManager[6] is Param_Integer lineCapParam)
        {
            lineCapParam.AddNamedValue("Butt", 0);
            lineCapParam.AddNamedValue("Round", 1);
            lineCapParam.AddNamedValue("Square", 2);
        }

        if (pManager[7] is Param_Integer lineJoinParam)
        {
            lineJoinParam.AddNamedValue("Miter", 0);
            lineJoinParam.AddNamedValue("Round", 1);
            lineJoinParam.AddNamedValue("Bevel", 2);
        }

        if (pManager[10] is Param_Integer fillRuleParam)
        {
            fillRuleParam.AddNamedValue("Even-Odd", 0);
            fillRuleParam.AddNamedValue("Non-Zero", 1);
        }
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
        var lineCap = 0;
        var lineJoin = 0;
        var dashValues = new List<double>();
        var nonScaling = false;
        var fillRuleInt = 0;

        DA.GetData(0, ref strokeColor);
        DA.GetData(1, ref strokeWidth);
        DA.GetData(2, ref strokeOpacity);
        DA.GetData(3, ref fillColor);
        DA.GetData(4, ref fill);
        DA.GetData(5, ref fillOpacity);
        DA.GetData(6, ref lineCap);
        DA.GetData(7, ref lineJoin);
        DA.GetDataList(8, dashValues);
        DA.GetData(9, ref nonScaling);
        DA.GetData(10, ref fillRuleInt);

        float[] dashArray = null;
        if (dashValues.Count > 0)
        {
            dashArray = new float[dashValues.Count];
            for (var i = 0; i < dashValues.Count; i++)
                dashArray[i] = (float)Math.Max(0, dashValues[i]);
        }

        var style = new PathStyleData
        {
            StrokeColor = strokeColor,
            StrokeWidth = (float)strokeWidth,
            StrokeOpacity = (float)Clamp01(strokeOpacity),
            HasStroke = true,
            FillColor = fillColor,
            HasFill = fill,
            FillOpacity = (float)Clamp01(fillOpacity),
            StrokeCap = (SvgStrokeCap)Math.Max(0, Math.Min(2, lineCap)),
            StrokeJoin = (SvgStrokeJoin)Math.Max(0, Math.Min(2, lineJoin)),
            DashArray = dashArray,
            NonScalingStroke = nonScaling,
            FillRule = fillRuleInt == 1 ? SvgFillRule.NonZero : SvgFillRule.EvenOdd
        };

        DA.SetData(0, style);
    }

    private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;
}
