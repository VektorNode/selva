using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing;
using Selva.Drawing.Model.Elements;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.Components;

public class GH_AngularDimension : SelvaZuiComponent
{
    public GH_AngularDimension()
        : base("Angular Dimension", "ADim",
            "Angular dimension at a vertex measuring the angle between vertex→A and vertex→B",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.AngularDimension;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("2D0CD233-7615-4DF5-8057-46DD7FD4ECBE");

    protected override IReadOnlyCollection<string> PrimaryInputs =>
        new[] { "Vertex", "Point A", "Point B", "Label", "Text Size", "Reflex" };

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

        if (!GetInput(DA, "Vertex", ref v)) return;
        if (!GetInput(DA, "Point A", ref a)) return;
        if (!GetInput(DA, "Point B", ref b)) return;
        GetInput(DA, "Label", ref label);
        GetInput(DA, "Text Size", ref textSize);
        GetInput(DA, "Color", ref color);
        GetInput(DA, "Stroke Width", ref stroke);
        GetInput(DA, "Tick Style", ref tickStyle);
        GetInput(DA, "Tick Size", ref tickSize);
        GetInput(DA, "Reflex", ref reflex);

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
