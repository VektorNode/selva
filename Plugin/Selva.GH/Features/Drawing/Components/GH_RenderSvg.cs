using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Rendering.Svg;
using Selva.GH.Features.FileIO;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.Components;

// Renders to SVG file(s). Accepts either a Document (one file per page) or loose drawing
// elements / DrawingViews (wrapped in a single-page document and rendered as one file).
// Multi-page documents produce "<name>-1.svg", "<name>-2.svg", ...; single-page produces
// just "<name>.svg".
public class GH_RenderSvg : GH_Component, ISelvaFileOutput
{
    public GH_RenderSvg()
        : base("Render SVG", "SVG",
            "Renders drawing content to SVG file(s) (downloadable via the Selva UI). " +
            "Input a Document for paginated multi-page output, or wire DrawingViews / loose " +
            "elements directly for a single-page SVG.",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.RenderSvg;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("69A739F3-44CB-42D7-BBF4-8A10B109AEB8");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "D", "A Document (paginated) or one or more DrawElements / DrawingViews to wrap into a single-page SVG", GH_ParamAccess.list);
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
        var inputs = new List<IGH_Goo>();
        var name = "drawing";
        var padding = 10.0;
        var autoFit = true;
        var bgColor = Color.Empty;
        var fontFamily = "";
        var embedFonts = false;
        var subFolder = "";

        if (!DA.GetDataList(0, inputs) || inputs.Count == 0) return;
        DA.GetData(1, ref name);
        DA.GetData(2, ref padding);
        DA.GetData(3, ref autoFit);
        DA.GetData(4, ref bgColor);
        DA.GetData(5, ref fontFamily);
        DA.GetData(6, ref embedFonts);
        DA.GetData(7, ref subFolder);

        if (!TryBuildDocument(inputs, name, out var doc, out var error))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, error);
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

    private static bool TryBuildDocument(List<IGH_Goo> inputs, string title, out Document doc, out string error)
    {
        // A single Document goes through unchanged. Anything else is treated as loose
        // DrawElements (curves, surfaces, dimensions, text, DrawingViews, ...) and wrapped
        // in a single-page document.
        if (inputs.Count == 1 && Unwrap(inputs[0]) is Document existing)
        {
            doc = existing;
            error = null;
            return true;
        }

        var elements = new List<DrawElement>(inputs.Count);
        foreach (var item in inputs)
        {
            switch (Unwrap(item))
            {
                case null:
                    continue;
                case DrawElement element:
                    elements.Add(element);
                    break;
                case Document _:
                    doc = null;
                    error = "Mixing a Document with loose drawing elements is not supported. Wire either a single Document or one or more drawing elements.";
                    return false;
                default:
                    doc = null;
                    error = $"Unsupported input type: {item?.GetType().Name ?? "null"}";
                    return false;
            }
        }

        if (elements.Count == 0)
        {
            doc = null;
            error = "No content provided";
            return false;
        }

        DrawElement content = elements.Count == 1
            ? elements[0]
            : new GroupElement { Children = elements };

        doc = new Document
        {
            Metadata = new DocumentMetadata { Title = title },
            Pages = new[]
            {
                new Page
                {
                    Title = title,
                    Content = content,
                },
            },
        };
        error = null;
        return true;
    }

    private static object Unwrap(IGH_Goo goo) => goo switch
    {
        null => null,
        GH_ObjectWrapper wrap => wrap.Value,
        _ => goo,
    };
}
