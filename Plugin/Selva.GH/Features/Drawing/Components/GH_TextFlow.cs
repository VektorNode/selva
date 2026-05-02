using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: paragraph layout. Wraps text using real font metrics for line
// breaking. Width unset (or 0) means "fill the available width from the parent layout"
// (Page, Frame, Stack, Grid cell). Hard newlines force paragraph breaks.
public class GH_TextFlow : GH_Component
{
    public GH_TextFlow()
        : base("Text Flow", "TFlow",
            "Wraps a paragraph of text to fit a fixed width with real font measurement",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.TextFlow;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("62C55B55-FE35-4D21-8B4E-821F117F406B");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Text", "T", "Text to wrap (use \\n for paragraph breaks)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Width", "W", "Maximum line width in millimetres (0 or unset = fill available width from the parent layout)", GH_ParamAccess.item, 0.0);
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

        double? wrapWidth = width > 0 ? width : null;
        var flow = new TextFlow
        {
            Text = text ?? string.Empty,
            Width = wrapWidth,
            Style = style ?? new TextStyle(),
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, flow);
    }
}
