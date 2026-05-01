using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Rendering.Pdf;
using Selva.GH.Features.FileIO;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.Components;

// Renders a Document to a PDF and emits a FileDataGoo so the result flows into the same
// download / context-bake pipeline as the other file producers (GeometryToFile, CreateFile).
// The PDF bytes are base64-encoded into FileData.Data; the Selva UI decodes and serves
// the download. PdfSharpCore handles multi-page natively, so an N-page Document → N-page PDF.
public class GH_RenderPdf : GH_Component, ISelvaFileOutput
{
    public GH_RenderPdf()
        : base("Render PDF", "PDF",
            "Renders a drawing document to a PDF file (downloadable via the Selva UI)",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.RenderPdf;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("F4A2D915-7B86-4A3C-AC8D-3FE7B0C1D2E3");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Document", "D", "Drawing document", GH_ParamAccess.item);
        pManager.AddTextParameter("Name", "N", "Output file name without extension", GH_ParamAccess.item, "drawing");
        pManager.AddNumberParameter("Padding", "P", "Padding around content when auto-fitting (mm)", GH_ParamAccess.item, 10.0);
        pManager.AddBooleanParameter("Auto Fit", "AF", "Auto-fit page to content. When false, page paper size is used.", GH_ParamAccess.item, true);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item, "");

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "PDF file data for download via the Selva UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Document doc = null;
        var name = "drawing";
        var padding = 10.0;
        var autoFit = true;
        var subFolder = "";

        if (!DA.GetData(0, ref doc) || doc == null) return;
        DA.GetData(1, ref name);
        DA.GetData(2, ref padding);
        DA.GetData(3, ref autoFit);
        DA.GetData(4, ref subFolder);

        try
        {
            var options = new PdfRenderOptions
            {
                Padding = padding,
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
