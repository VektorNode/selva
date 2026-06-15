using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Goos;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Properties;
using Color = System.Drawing.Color;
using ModelColor = Selva.Drawing.Model.Style.Color;

namespace Selva.GH.Features.Drawing.Components;

public class GH_PathStyle : GH_Component
{
    public GH_PathStyle()
        : base("Path Style", "Style",
            "Creates a stroke/fill style for curves and surfaces",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.PathStlye;
    public override GH_Exposure Exposure => GH_Exposure.senary;
    public override Guid ComponentGuid => new Guid("20587568-1E6E-481D-9ED8-AC136477E323");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Stroke Color", "SC", "Stroke color", GH_ParamAccess.item, Color.Black);
        pManager.AddNumberParameter("Stroke Width", "SW", "Stroke width in mm (paper space)", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Stroke Opacity", "SO", "Stroke opacity (0-1)", GH_ParamAccess.item, 1.0);
        pManager.AddColourParameter("Fill Color", "FC", "Fill color (closed paths)", GH_ParamAccess.item, Color.Transparent);
        pManager.AddBooleanParameter("Fill", "F", "Enable fill", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Fill Opacity", "FO", "Fill opacity (0-1)", GH_ParamAccess.item, 1.0);
        pManager.AddIntegerParameter("Line Cap", "LC", "Stroke line cap shape", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Line Join", "LJ", "Stroke line join shape", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Dash Pattern", "DP", "Stroke dash/gap lengths in mm (paper space), e.g. 5 2 1 2", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Fill Rule", "FR", "Fill rule for self-intersecting paths", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Hatch Pattern", "HP", "Fill hatch pattern (overrides solid fill)", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Pattern Scale", "PS", "Hatch pattern scale multiplier (1 = default)", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Pattern Angle", "PA", "Hatch pattern rotation in degrees", GH_ParamAccess.item, 0.0);

        pManager[8].Optional = true;
        pManager[9].Optional = true;
        pManager[10].Optional = true;
        pManager[11].Optional = true;
        pManager[12].Optional = true;

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

        if (pManager[9] is Param_Integer fillRuleParam)
        {
            fillRuleParam.AddNamedValue("Even-Odd", 0);
            fillRuleParam.AddNamedValue("Non-Zero", 1);
        }

        if (pManager[10] is Param_Integer hatchParam)
        {
            hatchParam.AddNamedValue("None (Solid)", 0);
            hatchParam.AddNamedValue("Lines", 1);
            hatchParam.AddNamedValue("Cross Hatch", 2);
            hatchParam.AddNamedValue("Dots", 3);
            hatchParam.AddNamedValue("Brick", 4);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_PathStyle("Style", "S", "Path style", "Selva", "Elements", GH_ParamAccess.item));
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
        var fillRuleInt = 0;
        var hatchPatternInt = 0;
        var patternScale = 1.0;
        var patternAngle = 0.0;

        DA.GetData(0, ref strokeColor);
        DA.GetData(1, ref strokeWidth);
        DA.GetData(2, ref strokeOpacity);
        DA.GetData(3, ref fillColor);
        DA.GetData(4, ref fill);
        DA.GetData(5, ref fillOpacity);
        DA.GetData(6, ref lineCap);
        DA.GetData(7, ref lineJoin);
        DA.GetDataList(8, dashValues);
        DA.GetData(9, ref fillRuleInt);
        DA.GetData(10, ref hatchPatternInt);
        DA.GetData(11, ref patternScale);
        DA.GetData(12, ref patternAngle);

        double[] dashArray = null;
        if (dashValues.Count > 0)
        {
            dashArray = new double[dashValues.Count];
            for (var i = 0; i < dashValues.Count; i++)
                dashArray[i] = Math.Max(0, dashValues[i]);
        }

        var stroke = new Stroke
        {
            Color = ToModelColor(strokeColor),
            Width = strokeWidth,
            Opacity = Clamp01(strokeOpacity),
            Cap = (StrokeCap)Math.Max(0, Math.Min(2, lineCap)),
            Join = (StrokeJoin)Math.Max(0, Math.Min(2, lineJoin)),
            DashArray = dashArray,
        };

        Fill fillStyle = null;
        var hatch = (HatchPattern)Math.Max(0, Math.Min(4, hatchPatternInt));
        if (fill || hatch != HatchPattern.None)
        {
            fillStyle = new Fill
            {
                Color = ToModelColor(fillColor),
                Opacity = Clamp01(fillOpacity),
                Rule = fillRuleInt == 1 ? FillRule.NonZero : FillRule.EvenOdd,
                Pattern = hatch,
                PatternScale = Math.Max(0.01, patternScale),
                PatternAngle = patternAngle,
            };
        }

        DA.SetData(0, new PathStyleGoo(new PathStyle { Stroke = stroke, Fill = fillStyle }));
    }

    private static ModelColor ToModelColor(Color c) => ModelColor.Rgb(c.R, c.G, c.B, c.A);

    private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;
}
