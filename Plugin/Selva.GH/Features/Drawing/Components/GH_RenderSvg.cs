using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
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
            "Input a Document for paginated multi-page output, or wire drawings / drawing views " +
            "directly for a single-page SVG.",
            "Selva", "Drawing")
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
        pManager.AddGenericParameter("Document", "Doc", "A Document for paginated multi-page output. You can also wire pages, drawing views, or loose drawings directly — they're wrapped into a single page.", GH_ParamAccess.list);
        pManager.AddTextParameter("Name", "N", "Output file name without extension", GH_ParamAccess.item, "drawing");
        pManager.AddBooleanParameter("Auto Fit", "AF", "Auto-fit viewBox to content with a 10mm margin. When false, the document's page size is used.", GH_ParamAccess.item, false);
        pManager.AddColourParameter("Background", "BG", "Background color (leave unconnected for transparent)", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Embed Fonts", "EF", "Embed bundled Inter as a @font-face data URI", GH_ParamAccess.item, false);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item, "");

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "SVG file data for download via the Selva UI (one item per page)", GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var inputs = new List<IGH_Goo>();
        var name = "drawing";
        var autoFit = false;
        var bgColor = Color.Empty;
        var embedFonts = false;
        var subFolder = "";

        if (!DA.GetDataList(0, inputs) || inputs.Count == 0) return;
        DA.GetData(1, ref name);
        DA.GetData(2, ref autoFit);
        DA.GetData(3, ref bgColor);
        DA.GetData(4, ref embedFonts);
        DA.GetData(5, ref subFolder);

        if (!RenderDocumentInput.TryBuildDocument(inputs, name, out var doc, out var wasLoose, out var error))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, error);
            return;
        }

        if (wasLoose && !autoFit)
        {
            var fitWarning = RenderDocumentInput.LoosePageFitWarning(doc);
            if (fitWarning != null) AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, fitWarning);
        }

        string backgroundColor = null;
        if (bgColor != Color.Empty)
        {
            backgroundColor = bgColor.A < 255
                ? $"rgba({bgColor.R},{bgColor.G},{bgColor.B},{(bgColor.A / 255f).ToString("0.####", CultureInfo.InvariantCulture)})"
                : $"rgb({bgColor.R},{bgColor.G},{bgColor.B})";
        }

        try
        {
            var options = new SvgRenderOptions
            {
                AutoFitToContent = autoFit,
                BackgroundColor = backgroundColor,
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
