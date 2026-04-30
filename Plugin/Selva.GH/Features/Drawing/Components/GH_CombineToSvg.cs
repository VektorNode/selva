using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CombineToSvg : GH_Component
{
    public GH_CombineToSvg()
        : base("Combine to SVG", "CTS",
            "Combines SVG curves and surfaces into one SVG document",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("3F8B5C1E-2D7A-4E9F-A4B6-1C3D5E7F8A9B");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Curves", "SC", "List of SVG curves", GH_ParamAccess.list);
        pManager.AddGenericParameter("SVG Surfaces", "SS", "List of SVG surfaces", GH_ParamAccess.list);
        pManager.AddGenericParameter("SVG Dimensions", "SD", "List of SVG dimensions", GH_ParamAccess.list);
        pManager.AddGenericParameter("SVG Text", "ST", "List of SVG text elements", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "SVG title", GH_ParamAccess.item, "Drawing");
        pManager.AddNumberParameter("Padding", "P", "Padding around content", GH_ParamAccess.item, 10.0);
        pManager.AddColourParameter("Background", "BG", "Background color (leave unconnected for transparent)", GH_ParamAccess.item);
        pManager.AddTextParameter("Font Family", "F", "CSS font-family stack applied to all text. Leave empty for default sans-serif.", GH_ParamAccess.item, "");

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("SVG", "SVG", "SVG document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var curves = new List<SvgCurveData>();
        var surfaces = new List<SvgSurfaceData>();
        var dimensions = new List<SvgDimensionData>();
        var texts = new List<SvgTextData>();
        var title = "Drawing";
        var padding = 10.0;
        var bgColor = Color.Empty;
        var fontFamily = "";

        DA.GetDataList(0, curves);
        DA.GetDataList(1, surfaces);
        DA.GetDataList(2, dimensions);
        DA.GetDataList(3, texts);
        DA.GetData(4, ref title);
        DA.GetData(5, ref padding);
        DA.GetData(6, ref bgColor);
        DA.GetData(7, ref fontFamily);

        if (curves.Count == 0 && surfaces.Count == 0 && dimensions.Count == 0 && texts.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No content provided");
            return;
        }

        string backgroundColor = null;
        if (bgColor != Color.Empty)
        {
            backgroundColor = bgColor.A < 255
                ? $"rgba({bgColor.R},{bgColor.G},{bgColor.B},{bgColor.A / 255f:0.####})"
                : $"rgb({bgColor.R},{bgColor.G},{bgColor.B})";
        }

        try
        {
            DA.SetData(0, SvgDocument.Build(curves, surfaces, dimensions, texts, title, padding, backgroundColor, fontFamily));
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error building SVG: {e.Message}");
        }
    }
}
