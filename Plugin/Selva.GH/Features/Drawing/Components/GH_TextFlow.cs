using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
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
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.TextFlow;
    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("62C55B55-FE35-4D21-8B4E-821F117F406B");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Text", "T", "Text to wrap (use \\n for paragraph breaks)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Width", "W", "Maximum line width in millimetres (0 or unset = fill available width from the parent layout)", GH_ParamAccess.item, 0.0);
        pManager.AddParameter(new Param_TextStyle("Style", "S", "Text style (use Text Style component; leave empty for default)", "Selva", "Layout", GH_ParamAccess.item));

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
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

        DA.GetData(0, ref text);
        DA.GetData(1, ref width);
        DA.GetData(2, ref style);

        double? wrapWidth = width > 0 ? width : null;
        var flow = new TextFlow
        {
            Text = text ?? string.Empty,
            Width = wrapWidth,
            Style = style ?? new TextStyle(),
        };

        DA.SetData(0, flow);
    }
}
