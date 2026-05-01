using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 6 component: bundles drawing elements onto a single Page with a chosen paper size
// and margins. Pages then flow into GH_Document → GH_RenderPdf / GH_RenderSvg.
public class GH_Page : GH_Component
{
    private Page _previewPage;
    private DrawElement _previewContent;
    private BoundingBox _clippingBox = BoundingBox.Empty;

    public GH_Page()
        : base("Page", "Page",
            "Wraps drawing elements into a single drawing page with a paper size and margins",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.Page;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("B27D9F11-3CC4-4F1B-9E25-7E9B0C5F2E18");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _clippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _previewPage = null;
        _previewContent = null;
        _clippingBox = BoundingBox.Empty;
    }

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

        _previewPage = page;
        // Layout primitives (Stack, Table, Frame, Grid, TextFlow) only become visitable
        // primitives after a layout pass — renderers do this automatically; the viewport
        // preview has to do it itself or those elements won't appear (and would throw).
        var resolved = LayoutPass.ResolvePage(page);
        _previewContent = resolved?.Content;
        _clippingBox = ComputeClippingBox(page);

        DA.SetData(0, page);
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden || _previewPage == null) return;

        var page = _previewPage;
        var w = page.Size.WidthMm;
        var h = page.Size.HeightMm;

        var paperColor = Attributes.Selected ? args.WireColour_Selected : Color.Black;
        var marginColor = Color.FromArgb(160, 160, 160);

        // Paper outline.
        var p0 = new Point3d(0, 0, 0);
        var p1 = new Point3d(w, 0, 0);
        var p2 = new Point3d(w, h, 0);
        var p3 = new Point3d(0, h, 0);
        args.Display.DrawPolyline(new Polyline(new[] { p0, p1, p2, p3, p0 }), paperColor, 2);

        // Margin rectangle (dotted).
        var m = page.Margins;
        var minX = m.Left;
        var minY = m.Bottom;
        var maxX = w - m.Right;
        var maxY = h - m.Top;
        if (maxX > minX && maxY > minY)
        {
            var q0 = new Point3d(minX, minY, 0);
            var q1 = new Point3d(maxX, minY, 0);
            var q2 = new Point3d(maxX, maxY, 0);
            var q3 = new Point3d(minX, maxY, 0);
            args.Display.DrawDottedLine(q0, q1, marginColor);
            args.Display.DrawDottedLine(q1, q2, marginColor);
            args.Display.DrawDottedLine(q2, q3, marginColor);
            args.Display.DrawDottedLine(q3, q0, marginColor);
        }

        // Paper-size label below the bottom-left corner — helps tell A4 from A3 at a glance.
        var label = page.Size.Name ?? $"{w:0}×{h:0}mm";
        var labelHeight = Math.Max(2.5, Math.Min(w, h) * 0.012);
        var labelPlane = new Plane(new Point3d(0, -labelHeight * 1.6, 0), Vector3d.XAxis, Vector3d.YAxis);
        args.Display.Draw3dText(label, marginColor, labelPlane, labelHeight, "Arial");

        if (_previewContent != null)
        {
            var visitor = new RhinoViewportVisitor(args.Display);
            visitor.Render(_previewContent);
        }
    }

    private static BoundingBox ComputeClippingBox(Page page)
    {
        if (page == null) return BoundingBox.Empty;
        // Paper rect plus a small margin for the size label.
        var padY = Math.Max(2.5, Math.Min(page.Size.WidthMm, page.Size.HeightMm) * 0.02);
        return new BoundingBox(
            new Point3d(0, -padY * 2, 0),
            new Point3d(page.Size.WidthMm, page.Size.HeightMm, 0));
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
