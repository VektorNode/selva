using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 8 component: takes a content tree and spills it across as many pages as needed.
// Layout primitives that override TrySplit (Stack between children for now; Table rows and
// TextFlow lines in later phases) break across page boundaries; everything else is atomic.
//
// Output is a list of Pages that flows directly into GH_Document → GH_RenderPdf/Svg, the
// same as GH_Page. Reach for GH_Page when the content fits one page; reach for GH_PageFlow
// when it might not.
//
// Header/Footer are optional chrome drawn on every page. Text elements inside them can use
// tokens — {page}, {pages}, {date}, {date:fmt}, {title} — and the resolver swaps them in
// per-page so a single header can carry "Page {page} of {pages}".
public class GH_PageFlow : GH_Component
{
    public GH_PageFlow()
        : base("Page Flow", "Flow",
            "Spills drawing content across as many pages as needed",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.Page;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("8E2D4A91-1F3C-4D6A-9B0E-7C5F2A8B3D14");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Content", "C", "Drawing elements to flow across pages", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Paper Size", "PS", "Paper size for every page", GH_ParamAccess.item, 4);
        pManager.AddBooleanParameter("Landscape", "L", "Rotate paper to landscape orientation", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Margin", "M", "Uniform page margin in millimetres", GH_ParamAccess.item, 10.0);
        pManager.AddGenericParameter("Header", "H", "Drawing element repeated at the top of every page (supports tokens like {page}, {pages}, {title})", GH_ParamAccess.item);
        pManager.AddGenericParameter("Footer", "F", "Drawing element repeated at the bottom of every page", GH_ParamAccess.item);
        pManager.AddNumberParameter("Header Height", "HH", "Reserved header height in millimetres. 0 = measure from header bounds.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Footer Height", "FH", "Reserved footer height in millimetres. 0 = measure from footer bounds.", GH_ParamAccess.item, 0.0);
        pManager.AddTextParameter("Title", "T", "Page title — substituted as {title} in header/footer text and stored on every Page.", GH_ParamAccess.item, string.Empty);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
        pManager[8].Optional = true;

        if (pManager[1] is Param_Integer paperParam)
        {
            paperParam.AddNamedValue("A0", 0);
            paperParam.AddNamedValue("A1", 1);
            paperParam.AddNamedValue("A2", 2);
            paperParam.AddNamedValue("A3", 3);
            paperParam.AddNamedValue("A4", 4);
            paperParam.AddNamedValue("A5", 5);
            paperParam.AddNamedValue("Letter", 6);
            paperParam.AddNamedValue("Legal", 7);
            paperParam.AddNamedValue("Tabloid", 8);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Pages", "P", "Drawing pages, in order", GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var elements = new List<DrawElement>();
        var paperIndex = 4;
        var landscape = false;
        var margin = 10.0;
        DrawElement header = null;
        DrawElement footer = null;
        var headerHeight = 0.0;
        var footerHeight = 0.0;
        var title = string.Empty;

        DA.GetDataList(0, elements);
        DA.GetData(1, ref paperIndex);
        DA.GetData(2, ref landscape);
        DA.GetData(3, ref margin);
        DA.GetData(4, ref header);
        DA.GetData(5, ref footer);
        DA.GetData(6, ref headerHeight);
        DA.GetData(7, ref footerHeight);
        DA.GetData(8, ref title);

        var paper = ResolvePaper(paperIndex);
        if (landscape) paper = paper.Landscape();
        var margins = Margins.Uniform(Math.Max(0, margin));

        var children = new List<DrawElement>(elements.Count);
        foreach (var e in elements) if (e != null) children.Add(e);

        if (children.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No content provided");
            return;
        }

        // Wrap a multi-element list in a vertical Stack so pagination breaks between items.
        // A single element passes through as-is so a Table or pre-built Stack keeps its own
        // semantics (spacing, alignment).
        DrawElement content = children.Count == 1
            ? children[0]
            : new Stack { Children = children, Orientation = StackOrientation.Vertical };

        var template = new PageTemplate
        {
            Title = title,
            Header = header,
            Footer = footer,
            HeaderHeight = headerHeight > 0 ? headerHeight : (double?)null,
            FooterHeight = footerHeight > 0 ? footerHeight : (double?)null,
        };

        var pages = PaginationPass.Paginate(content, paper, margins, template);
        DA.SetDataList(0, pages);
    }

    private static PaperSize ResolvePaper(int i) => i switch
    {
        0 => PaperSize.A0,
        1 => PaperSize.A1,
        2 => PaperSize.A2,
        3 => PaperSize.A3,
        5 => PaperSize.A5,
        6 => PaperSize.Letter,
        7 => PaperSize.Legal,
        8 => PaperSize.Tabloid,
        _ => PaperSize.A4,
    };
}
