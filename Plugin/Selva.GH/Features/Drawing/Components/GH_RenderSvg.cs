using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Rendering.Svg;
using Selva.GH.Features.FileIO;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.Components;

// Renders a Document to one SVG per page (Decision #3 in the architecture plan: "one file
// per page"). Emits FileDataGoo so the results flow into the Selva UI download pipeline
// the same way GeometryToFile / CreateFile / RenderPdf do. Multi-page documents produce
// "<name>-1.svg", "<name>-2.svg", ...; single-page produces just "<name>.svg".
public class GH_RenderSvg : GH_Component, ISelvaFileOutput
{
    public GH_RenderSvg()
        : base("Render SVG", "SVG",
            "Renders a drawing document to SVG file(s), one per page (downloadable via the Selva UI)",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("E1B6B3F7-9D24-4F23-B47D-5C1C8F2D3E40");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Document", "D", "Drawing document", GH_ParamAccess.item);
        pManager.AddTextParameter("Name", "N", "Output file name without extension", GH_ParamAccess.item, "drawing");
        pManager.AddNumberParameter("Padding", "P", "Padding around content when auto-fitting (mm)", GH_ParamAccess.item, 10.0);
        pManager.AddBooleanParameter("Auto Fit", "AF", "Auto-fit viewBox to content. When false, page paper size is used.", GH_ParamAccess.item, true);
        pManager.AddColourParameter("Background", "BG", "Background color (leave unconnected for transparent)", GH_ParamAccess.item);
        pManager.AddTextParameter("Font Family", "F", "CSS font-family stack applied to all text. Leave empty for default sans-serif.", GH_ParamAccess.item, "");
        pManager.AddBooleanParameter("Embed Fonts", "EF", "Embed bundled Inter as a @font-face data URI", GH_ParamAccess.item, false);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item, "");

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "SVG file data for download via the Selva UI (one item per page)", GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Document doc = null;
        var name = "drawing";
        var padding = 10.0;
        var autoFit = true;
        var bgColor = Color.Empty;
        var fontFamily = "";
        var embedFonts = false;
        var subFolder = "";

        if (!DA.GetData(0, ref doc) || doc == null) return;
        DA.GetData(1, ref name);
        DA.GetData(2, ref padding);
        DA.GetData(3, ref autoFit);
        DA.GetData(4, ref bgColor);
        DA.GetData(5, ref fontFamily);
        DA.GetData(6, ref embedFonts);
        DA.GetData(7, ref subFolder);

        string backgroundColor = null;
        if (bgColor != Color.Empty)
        {
            backgroundColor = bgColor.A < 255
                ? $"rgba({bgColor.R},{bgColor.G},{bgColor.B},{bgColor.A / 255f:0.####})"
                : $"rgb({bgColor.R},{bgColor.G},{bgColor.B})";
        }

        try
        {
            var options = new SvgRenderOptions
            {
                Padding = padding,
                AutoFitToContent = autoFit,
                BackgroundColor = backgroundColor,
                FontFamily = string.IsNullOrWhiteSpace(fontFamily)
                    ? SvgRenderOptions.DefaultFontFamily
                    : fontFamily,
                EmbedFonts = embedFonts,
            };

            var rendered = new SvgRenderer(options).RenderAll(doc);
            var baseName = string.IsNullOrWhiteSpace(name) ? "drawing" : name;
            var results = new List<FileDataGoo>(rendered.Count);
            for (var i = 0; i < rendered.Count; i++)
            {
                // Single page → "drawing.svg". Multi-page → "drawing-1.svg", "drawing-2.svg".
                var fileName = rendered.Count == 1 ? baseName : $"{baseName}-{i + 1}";
                results.Add(new FileDataGoo(new FileData
                {
                    FileName = fileName,
                    Data = rendered[i],
                    FileType = ".svg",
                    IsBase64Encoded = false,
                    SubFolder = subFolder ?? "",
                }));
            }
            DA.SetDataList(0, results);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error rendering SVG: {e.Message}");
        }
    }
}
