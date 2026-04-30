using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: paragraph layout. Wraps text to fit a fixed width using real
// font metrics for line breaking. Hard newlines force paragraph breaks.
public class GH_TextFlow : GH_Component
{
    public GH_TextFlow()
        : base("Text Flow", "TFlow",
            "Wraps a paragraph of text to fit a fixed width with real font measurement",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("C7E89F01-2B3C-4D5E-AF60-718293A4B5C6");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Text", "T", "Text to wrap (use \\n for paragraph breaks)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Width", "W", "Maximum line width in millimetres (0 = no wrapping)", GH_ParamAccess.item, 0.0);
        pManager.AddGenericParameter("Style", "S", "Text style (leave empty for default)", GH_ParamAccess.item);
        pManager.AddPointParameter("Origin", "P", "Bottom-left of the text block in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var text = "";
        var width = 0.0;
        TextStyle style = null;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref text);
        DA.GetData(1, ref width);
        DA.GetData(2, ref style);
        DA.GetData(3, ref origin);

        var flow = new TextFlow
        {
            Text = text ?? string.Empty,
            Width = Math.Max(0, width),
            Style = style ?? new TextStyle(),
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, flow);
    }
}
