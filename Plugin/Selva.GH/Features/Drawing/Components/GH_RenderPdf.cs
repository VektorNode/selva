using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Rendering.Pdf;
using Selva.GH.Features.FileIO;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.Components;

// Renders to PDF and emits a FileDataGoo so the result flows into the same download /
// context-bake pipeline as the other file producers (GeometryToFile, CreateFile). Accepts
// either a Document (multi-page) or loose drawing elements (wrapped in a single page) —
// the same inputs as Render SVG, so switching formats doesn't require restructuring the
// graph. The PDF bytes are base64-encoded into FileData.Data; the Selva UI decodes and
// serves the download. PdfSharpCore handles multi-page natively.
public class GH_RenderPdf : GH_Component, ISelvaFileOutput
{
    public GH_RenderPdf()
        : base("Render PDF", "PDF",
            "Renders drawing content to a PDF file (downloadable via the Selva UI). " +
            "Input a Document for paginated multi-page output, or wire drawings / drawing views " +
            "directly for a single-page PDF.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.RenderPdf;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("7A284A84-2669-46B8-9FCB-46161D611689");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Document", "Doc", "A Document for paginated multi-page output. You can also wire pages, drawing views, or loose drawings directly — they're wrapped into a single page.", GH_ParamAccess.list);
        pManager.AddTextParameter("Name", "N", "Output file name without extension", GH_ParamAccess.item, "drawing");
        pManager.AddBooleanParameter("Auto Fit", "AF", "Auto-fit page to content with a 10mm margin. When false, the document's page size is used.", GH_ParamAccess.item, false);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item, "");

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "PDF file data for download via the Selva UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var inputs = new List<IGH_Goo>();
        var name = "drawing";
        var autoFit = false;
        var subFolder = "";

        if (!DA.GetDataList(0, inputs) || inputs.Count == 0) return;
        DA.GetData(1, ref name);
        DA.GetData(2, ref autoFit);
        DA.GetData(3, ref subFolder);

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

        try
        {
            var options = new PdfRenderOptions
            {
                AutoFitToContent = autoFit,
            };
            var bytes = new PdfRenderer(options).Render(doc);

            var fileData = new FileData
            {
                FileName = string.IsNullOrWhiteSpace(name) ? "drawing" : name,
                Data = Convert.ToBase64String(bytes),
                FileType = ".pdf",
                IsBase64Encoded = true,
                SubFolder = subFolder ?? "",
            };

            DA.SetData(0, new FileDataGoo(fileData));
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error rendering PDF: {ex.Message}");
        }
    }
}
