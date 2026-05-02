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

// Wraps drawing elements into a Section that flows into GH_Document. The section is the
// unrendered description; GH_Document drives pagination and global token resolution so
// page numbering is correct across multi-section documents.
//
// All paper / margin / chrome inputs are optional. Leave them unset (paper / margin = -1,
// header / footer null) to inherit the document defaults. Set them to override for that
// section's pages only.
//
// Preview tiles the section's pages left-to-right using only this section's chrome and
// numbering — the document-wide page count is unknown until GH_Document runs, so {page} /
// {pages} in the preview reflect section-local counts. The PDF / SVG output uses the global
// counts via GH_Document.
public class GH_Page : GH_Component
{
    private List<Page> _previewPages;
    private List<DrawElement> _previewContents;
    private BoundingBox _clippingBox = BoundingBox.Empty;

    private const double TileGapMm = 20.0;

    public GH_Page()
        : base("Page", "Page",
            "Wraps drawing elements into a section that flows into GH_Document. Inherits paper, margins, and chrome from the document unless overridden.",
            "Selva", "Document")
    {
    }

    protected override Bitmap Icon => Resources.Page;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("AA5EAA20-2AD8-4ECE-8DA5-BB275BF36456");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _clippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _previewPages = null;
        _previewContents = null;
        _clippingBox = BoundingBox.Empty;
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Content", "C", "Drawing elements to flow across the section's pages", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "Section title — surfaces via the {section} token in chrome and is stamped on each output Page", GH_ParamAccess.item, string.Empty);
        pManager.AddIntegerParameter("Paper Size", "PS", "Paper size for this section. -1 inherits the document's paper size.", GH_ParamAccess.item, -1);
        pManager.AddBooleanParameter("Landscape", "L", "Rotate the overridden paper to landscape. Ignored when Paper Size is set to Inherit.", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Margin", "M", "Uniform page margin in millimetres. -1 inherits the document's margin.", GH_ParamAccess.item, -1.0);
        pManager.AddGenericParameter("Header", "H", "Optional override of the document header for this section's pages.", GH_ParamAccess.item);
        pManager.AddGenericParameter("Footer", "F", "Optional override of the document footer for this section's pages.", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Keep Together", "KT", "When true, the entire section is forced onto a single page even if its content overflows.", GH_ParamAccess.item, false);

        for (var i = 1; i <= 7; i++) pManager[i].Optional = true;

        if (pManager[2] is Param_Integer paperParam)
        {
            paperParam.AddNamedValue("Inherit", -1);
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
        pManager.AddGenericParameter("Section", "S", "Section to plug into GH_Document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var elements = new List<DrawElement>();
        var title = string.Empty;
        var paperIndex = -1;
        var landscape = false;
        var margin = -1.0;
        DrawElement header = null;
        DrawElement footer = null;
        var keepTogether = false;

        DA.GetDataList(0, elements);
        DA.GetData(1, ref title);
        DA.GetData(2, ref paperIndex);
        DA.GetData(3, ref landscape);
        DA.GetData(4, ref margin);
        DA.GetData(5, ref header);
        DA.GetData(6, ref footer);
        DA.GetData(7, ref keepTogether);

        var children = new List<DrawElement>(elements.Count);
        foreach (var e in elements) if (e != null) children.Add(e);

        if (children.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No content provided");
            return;
        }

        // Wrap a multi-element list in a Group so children keep their absolute world
        // positions — drawings (line + dimension annotating that line) depend on relative
        // geometry. A Stack would re-flow children top-to-bottom by bounding box and break
        // that alignment. Pass a pre-built Stack/Table as a single element to opt into flow.
        DrawElement content = children.Count == 1
            ? children[0]
            : new GroupElement { Children = children };

        PaperSize? paperOverride = null;
        if (paperIndex >= 0)
        {
            var p = ResolvePaper(paperIndex);
            paperOverride = landscape ? p.Landscape() : p;
        }

        Margins? marginOverride = margin >= 0 ? Margins.Uniform(margin) : (Margins?)null;

        var section = new Section
        {
            Content = content,
            Title = title,
            PaperSize = paperOverride,
            Margins = marginOverride,
            Header = header,
            Footer = footer,
            KeepTogether = keepTogether,
        };

        BuildPreview(section);

        DA.SetData(0, section);
    }

    // Section-local preview: paginate this section alone with no document chrome to give the
    // user a fast visual confirmation of how the content splits. Doc-level header/footer and
    // global page counts come from GH_Document at the end of the chain.
    private void BuildPreview(Section section)
    {
        var paper = section.PaperSize ?? PaperSize.A4;
        var margins = section.Margins ?? Margins.Uniform(10);

        var layout = new DocumentLayout
        {
            Sections = new[] { section },
            PaperSize = paper,
            Margins = margins,
            // Section-local chrome is shown if the section overrides chrome; otherwise the
            // preview has no chrome and the user sees just the body.
        };
        var pages = DocumentLayoutPass.Paginate(layout);

        _previewPages = new List<Page>(pages);
        _previewContents = new List<DrawElement>(pages.Count);
        foreach (var p in pages)
        {
            var resolved = LayoutPass.ResolvePage(p);
            _previewContents.Add(resolved?.Content);
        }
        _clippingBox = ComputeClippingBox(pages);
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden || _previewPages == null || _previewPages.Count == 0) return;

        var paperColor = Attributes.Selected ? args.WireColour_Selected : Color.Black;
        var marginColor = Color.FromArgb(160, 160, 160);

        var xCursor = 0.0;
        for (var i = 0; i < _previewPages.Count; i++)
        {
            var page = _previewPages[i];
            var w = page.Size.WidthMm;
            var h = page.Size.HeightMm;

            var p0 = new Point3d(xCursor, 0, 0);
            var p1 = new Point3d(xCursor + w, 0, 0);
            var p2 = new Point3d(xCursor + w, h, 0);
            var p3 = new Point3d(xCursor, h, 0);
            args.Display.DrawPolyline(new Polyline(new[] { p0, p1, p2, p3, p0 }), paperColor, 2);

            var m = page.Margins;
            var minX = xCursor + m.Left;
            var minY = m.Bottom;
            var maxX = xCursor + w - m.Right;
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

            var labelHeight = Math.Max(2.5, Math.Min(w, h) * 0.012);
            var label = _previewPages.Count > 1
                ? $"{i + 1}/{_previewPages.Count} · {page.Size.Name ?? $"{w:0}×{h:0}mm"}"
                : page.Size.Name ?? $"{w:0}×{h:0}mm";
            var labelPlane = new Plane(new Point3d(xCursor, -labelHeight * 1.6, 0), Vector3d.XAxis, Vector3d.YAxis);
            args.Display.Draw3dText(label, marginColor, labelPlane, labelHeight, "Arial");

            var content = i < _previewContents.Count ? _previewContents[i] : null;
            if (content != null)
            {
                DrawElement tile = Math.Abs(xCursor) < 1e-9
                    ? content
                    : new GroupElement
                    {
                        Transform = Selva.Drawing.Model.Geometry.Transform.Translate(xCursor, 0),
                        Children = new[] { content },
                    };
                var visitor = new RhinoViewportVisitor(args.Display);
                visitor.Render(tile);
            }

            xCursor += w + TileGapMm;
        }
    }

    private static BoundingBox ComputeClippingBox(IReadOnlyList<Page> pages)
    {
        if (pages == null || pages.Count == 0) return BoundingBox.Empty;
        var xCursor = 0.0;
        var maxH = 0.0;
        foreach (var p in pages)
        {
            xCursor += p.Size.WidthMm + TileGapMm;
            if (p.Size.HeightMm > maxH) maxH = p.Size.HeightMm;
        }
        var totalWidth = Math.Max(0, xCursor - TileGapMm);
        var padY = Math.Max(2.5, Math.Min(totalWidth, maxH) * 0.02);
        return new BoundingBox(
            new Point3d(0, -padY * 2, 0),
            new Point3d(totalWidth, maxH, 0));
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
