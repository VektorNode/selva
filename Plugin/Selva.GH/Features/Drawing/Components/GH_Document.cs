using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;

namespace Selva.GH.Features.Drawing.Components;

// Phase 6 component: collects Pages plus optional metadata into a Document. The Document
// then flows into GH_RenderSvg / GH_RenderPdf. Metadata maps to the PDF /Info dictionary
// and to the SVG <title>/document chrome.
public class GH_Document : GH_Component
{
    public GH_Document()
        : base("Document", "Doc",
            "Bundles one or more pages into a drawing document with metadata",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("D6F37B49-9CFF-4D5E-94B6-2C0B8E7FD0A7");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Pages", "P", "Pages in the document (in order)", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "Document title", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Author", "A", "Document author", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Subject", "S", "Document subject", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Keywords", "K", "Comma-separated keyword list", GH_ParamAccess.list);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Document", "D", "Drawing document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var pages = new List<Page>();
        var title = "";
        var author = "";
        var subject = "";
        var keywords = new List<string>();

        DA.GetDataList(0, pages);
        DA.GetData(1, ref title);
        DA.GetData(2, ref author);
        DA.GetData(3, ref subject);
        DA.GetDataList(4, keywords);

        if (pages.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No pages provided");
            return;
        }

        var validPages = new List<Page>(pages.Count);
        foreach (var p in pages) if (p != null) validPages.Add(p);

        var keywordList = keywords.Count > 0 ? keywords.ToArray() : null;

        var doc = new Document
        {
            Pages = validPages,
            Metadata = new DocumentMetadata
            {
                Title = NullIfEmpty(title),
                Author = NullIfEmpty(author),
                Subject = NullIfEmpty(subject),
                Keywords = keywordList,
                Creator = "Selva",
                Producer = "Selva.Drawing",
                CreatedAt = DateTime.UtcNow,
            },
        };

        DA.SetData(0, doc);
    }

    private static string NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;
}
