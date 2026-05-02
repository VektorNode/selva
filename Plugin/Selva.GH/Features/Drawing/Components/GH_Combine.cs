using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Rendering.Svg;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

public class GH_Combine : GH_Component
{
    public GH_Combine()
        : base("Combine", "Comb",
            "Combines drawing elements into a single-page SVG document. " +
            "For multi-page output or PDF export, use Page → Document → Render SVG/PDF instead.",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.Combine;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("5CF6402E-FE8E-4ED3-9124-4034C9950790");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Curves", "C", "List of curve elements", GH_ParamAccess.list);
        pManager.AddGenericParameter("Surfaces", "S", "List of surface elements", GH_ParamAccess.list);
        pManager.AddGenericParameter("Dimensions", "D", "List of dimension elements", GH_ParamAccess.list);
        pManager.AddGenericParameter("Text", "T", "List of text elements", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "Ti", "Document title", GH_ParamAccess.item, "Drawing");
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
        // Four typed input ports — the same wiring users have today — but every port carries
        // DrawElement subclasses. Surfaces and curves both arrive as PathElement; they live
        // in separate ports purely to preserve port labels / GH definition compatibility.
        var curves = new List<PathElement>();
        var surfaces = new List<PathElement>();
        var dimensions = new List<DimensionElement>();
        var texts = new List<TextElement>();
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

        // Render order matches the legacy SvgDocument: surfaces first (so curves draw on top),
        // then curves, dimensions, text. Group keeps the renderer's single Y-flip wrapping.
        var children = new List<DrawElement>();
        children.AddRange(surfaces);
        children.AddRange(curves);
        children.AddRange(dimensions);
        children.AddRange(texts);

        string backgroundColor = null;
        if (bgColor != Color.Empty)
        {
            backgroundColor = bgColor.A < 255
                ? $"rgba({bgColor.R},{bgColor.G},{bgColor.B},{bgColor.A / 255f:0.####})"
                : $"rgb({bgColor.R},{bgColor.G},{bgColor.B})";
        }

        try
        {
            var doc = new Document
            {
                Metadata = new DocumentMetadata { Title = title },
                Pages = new[]
                {
                    new Page
                    {
                        Title = title,
                        Content = new GroupElement { Children = children },
                    },
                },
            };

            var options = new SvgRenderOptions
            {
                Padding = padding,
                BackgroundColor = backgroundColor,
                FontFamily = string.IsNullOrWhiteSpace(fontFamily)
                    ? SvgRenderOptions.DefaultFontFamily
                    : fontFamily,
                AutoFitToContent = true,
            };

            DA.SetData(0, new SvgRenderer(options).Render(doc));
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error building SVG: {e.Message}");
        }
    }
}
