using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing;
using Selva.Drawing.Model.Elements;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

public class GH_AngularDimension : GH_Component
{
    public GH_AngularDimension()
        : base("Angular Dimension", "ADim",
            "Angular dimension at a vertex measuring the angle between vertex→A and vertex→B",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.AngularDimension;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("A90C4D76-9482-4501-A905-F9221656B6C8");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {

        pManager.AddPointParameter("Vertex", "V", "Vertex where the two arms meet", GH_ParamAccess.item);
        pManager.AddPointParameter("Point A", "A", "Point on first arm", GH_ParamAccess.item);
        pManager.AddPointParameter("Point B", "B", "Point on second arm", GH_ParamAccess.item);
        pManager.AddTextParameter("Label", "L", "Override label (default: degrees with ° suffix)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Text Size", "TS", "Text height in drawing units", GH_ParamAccess.item, 2.5);
        pManager.AddColourParameter("Color", "C", "Dimension color", GH_ParamAccess.item, Color.Black);
        pManager.AddNumberParameter("Stroke Width", "SW", "Line stroke width in mm (paper space). 0 = no dimension lines (the label still draws)", GH_ParamAccess.item, 0.5);
        pManager.AddIntegerParameter("Tick Style", "TK", "Tick mark style at arc endpoints", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Tick Size", "TZ", "Tick/arrow size in drawing units (mm), independent of Text Size", GH_ParamAccess.item, 4.0);
        pManager.AddBooleanParameter("Reflex", "X", "Measure the outer (reflex) angle instead of the inner angle", GH_ParamAccess.item, false);


        pManager[3].Optional = true;
        pManager[9].Optional = true;

        if (pManager[7] is Param_Integer tickParam)
        {
            tickParam.AddNamedValue("Arrow", 0);
            tickParam.AddNamedValue("Tick (architectural)", 1);
            tickParam.AddNamedValue("None", 2);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var v = Point3d.Unset;
        var a = Point3d.Unset;
        var b = Point3d.Unset;
        var label = "";
        var textSize = 2.5;
        var color = Color.Black;
        var stroke = 0.5;
        var tickStyle = 0;
        var tickSize = 4.0;
        var reflex = false;

        if (!DA.GetData(0, ref v)) return;
        if (!DA.GetData(1, ref a)) return;
        if (!DA.GetData(2, ref b)) return;
        DA.GetData(3, ref label);
        DA.GetData(4, ref textSize);
        DA.GetData(5, ref color);
        DA.GetData(6, ref stroke);
        DA.GetData(7, ref tickStyle);
        DA.GetData(8, ref tickSize);
        DA.GetData(9, ref reflex);

        var style = new DimensionStyle
        {
            TextSize = textSize,
            StrokeWidth = stroke,
            Color = Selva.Drawing.Model.Style.Color.Rgb(color.R, color.G, color.B, color.A),
            TickKind = (DimensionTickKind)Math.Max(0, Math.Min(2, tickStyle)),
            ArrowSize = Math.Max(0, tickSize),
        };

        var element = AngularDimensionBuilder.Build(v.X, v.Y, a.X, a.Y, b.X, b.Y, label, style, reflex);
        if (element == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Invalid angular dimension (collinear arms)");
            return;
        }

        DA.SetData(0, element);
    }
}
