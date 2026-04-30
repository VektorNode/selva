using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;

namespace Selva.GH.Features.Drawing.Components;

// Phase 6 component: bundles drawing elements onto a single Page with a chosen paper size
// and margins. Pages then flow into GH_Document → GH_RenderPdf / GH_RenderSvg.
public class GH_Page : GH_Component
{
    public GH_Page()
        : base("Page", "Page",
            "Wraps drawing elements into a single drawing page with a paper size and margins",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("B27D9F11-3CC4-4F1B-9E25-7E9B0C5F2E18");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Elements", "E", "Drawing elements to place on this page", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "Page title (used as <svg><title> and shown in PDF outline when set)", GH_ParamAccess.item, "");
        pManager.AddIntegerParameter("Paper Size", "PS", "Paper size — only used when auto-fit is disabled in the renderer", GH_ParamAccess.item, 4);
        pManager.AddBooleanParameter("Landscape", "L", "Rotate paper to landscape orientation", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Margin", "M", "Uniform page margin in millimetres", GH_ParamAccess.item, 10.0);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;

        if (pManager[2] is Param_Integer paperParam)
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
        pManager.AddGenericParameter("Page", "P", "Drawing page", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var elements = new List<DrawElement>();
        var title = "";
        var paperIndex = 4;
        var landscape = false;
        var margin = 10.0;

        DA.GetDataList(0, elements);
        DA.GetData(1, ref title);
        DA.GetData(2, ref paperIndex);
        DA.GetData(3, ref landscape);
        DA.GetData(4, ref margin);

        var paper = ResolvePaper(paperIndex);
        if (landscape) paper = paper.Landscape();

        var children = new List<DrawElement>(elements.Count);
        foreach (var e in elements) if (e != null) children.Add(e);

        var page = new Page
        {
            Title = title,
            Size = paper,
            Margins = Margins.Uniform(Math.Max(0, margin)),
            Content = new GroupElement { Children = children },
        };

        DA.SetData(0, page);
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
