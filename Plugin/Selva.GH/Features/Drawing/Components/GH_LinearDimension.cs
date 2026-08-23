using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing;
using Selva.Drawing.Model.Elements;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

public class GH_LinearDimension : GH_Component
{
    public GH_LinearDimension()
        : base("Linear Dimension", "LDim",
            "Aligned linear dimension between two points, offset perpendicular to the segment",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.LinearDimension;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("90160C4E-C8C8-4777-BD42-53347E115120");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddPointParameter("Point A", "A", "Start point", GH_ParamAccess.item);
        pManager.AddPointParameter("Point B", "B", "End point", GH_ParamAccess.item);
        pManager.AddNumberParameter("Offset", "O", "Perpendicular offset distance in mm on the printed sheet; stays constant at any Drawing View scale. Positive = left of A→B", GH_ParamAccess.item, 5.0);
        pManager.AddTextParameter("Label", "L", "Override label (default: distance)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Text Size", "TS", "Text height in mm (paper space)", GH_ParamAccess.item, 2.5);
        pManager.AddColourParameter("Color", "C", "Dimension color", GH_ParamAccess.item, Color.Black);
        pManager.AddNumberParameter("Stroke Width", "SW", "Line stroke width in mm (paper space). 0 = no dimension lines (the label still draws)", GH_ParamAccess.item, 0.5);
        pManager.AddIntegerParameter("Tick Style", "TK", "Tick mark style at line endpoints", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Tick Size", "TZ", "Tick/arrow size in drawing units (mm), independent of Text Size", GH_ParamAccess.item, 4.0);
        pManager.AddIntegerParameter("Text Placement", "TP", "Where the label sits relative to the dimension line", GH_ParamAccess.item, 0);


        pManager[3].Optional = true;

        if (pManager[7] is Param_Integer tickParam)
        {
            tickParam.AddNamedValue("Arrow", 0);
            tickParam.AddNamedValue("Tick (architectural)", 1);
            tickParam.AddNamedValue("None", 2);
        }

        if (pManager[9] is Param_Integer placementParam)
        {
            placementParam.AddNamedValue("Above line", 0);
            placementParam.AddNamedValue("Break line", 1);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var a = Point3d.Unset;
        var b = Point3d.Unset;
        var offset = 5.0;
        var label = "";
        var textSize = 2.5;
        var color = Color.Black;
        var stroke = 0.5;
        var tickStyle = 0;
        var tickSize = 4.0;
        var textPlacement = 0;

        if (!DA.GetData(0, ref a)) return;
        if (!DA.GetData(1, ref b)) return;
        DA.GetData(2, ref offset);
        DA.GetData(3, ref label);
        DA.GetData(4, ref textSize);
        DA.GetData(5, ref color);
        DA.GetData(6, ref stroke);
        DA.GetData(7, ref tickStyle);
        DA.GetData(8, ref tickSize);
        DA.GetData(9, ref textPlacement);

        var style = new DimensionStyle
        {
            TextSize = textSize,
            StrokeWidth = stroke,
            Color = Selva.Drawing.Model.Style.Color.Rgb(color.R, color.G, color.B, color.A),
            TickKind = (DimensionTickKind)Math.Max(0, Math.Min(2, tickStyle)),
            ArrowSize = Math.Max(0, tickSize),
            TextPlacement = (DimensionTextPlacement)Math.Max(0, Math.Min(1, textPlacement)),
        };

        var element = LinearDimensionBuilder.Build(a.X, a.Y, b.X, b.Y, offset, label, style);
        if (element == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Points coincide");
            return;
        }

        DA.SetData(0, element);
    }
}
