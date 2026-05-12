using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using ModelBoundingBox = Selva.Drawing.Model.Geometry.BoundingBox;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Wraps drawing elements into a Section that flows into GH_Document. The section is the
// unrendered description; GH_Document drives pagination and global token resolution so
// page numbering is correct across multi-section documents.
//
// Per-section paper / margin / chrome overrides live on the optional Override input
// (produced by GH_LayoutOverride). Most pages don't need it — leave it unconnected and
// the section inherits every default from the Document.
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
            "Wraps drawing elements into a section that flows into GH_Document. Use a Section Override for per-section paper / chrome.",
            "Selva", "Drawing")
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
        pManager.AddGenericParameter("Override", "O", "Optional per-section overrides (paper, margins, chrome) from a Layout Override component. Leave unconnected to inherit everything from the Document.", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Keep Together", "KT", "When true, the entire section is forced onto a single page even if its content overflows.", GH_ParamAccess.item, false);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Section", "S", "Section to plug into GH_Document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var elements = new List<DrawElement>();
        var title = string.Empty;
        IGH_Goo overrideGoo = null;
        var keepTogether = false;

        DA.GetDataList(0, elements);
        DA.GetData(1, ref title);
        DA.GetData(2, ref overrideGoo);
        DA.GetData(3, ref keepTogether);

        var overrides = Unwrap(overrideGoo) as LayoutOverride;
        if (overrideGoo != null && overrides == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Override input must be a Layout Override value — ignoring.");
        }

        WarnIfChromeHasOrigin(overrides?.Header, "Header");
        WarnIfChromeHasOrigin(overrides?.Footer, "Footer");

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

        if (children.Count > 1)
        {
            WarnOnDirectMultiElementLayout(
                children,
                overrides?.PaperSize ?? PaperSize.A4,
                overrides?.Margins ?? Margins.Uniform(10));
        }

        var section = new Section
        {
            Content = content,
            Title = title,
            PaperSize = overrides?.PaperSize,
            Margins = overrides?.Margins,
            Header = overrides?.Header,
            Footer = overrides?.Footer,
            HeaderHeight = overrides?.HeaderHeight,
            FooterHeight = overrides?.FooterHeight,
            HeaderAlign = overrides?.HeaderAlign,
            FooterAlign = overrides?.FooterAlign,
            HeaderPlacement = overrides?.HeaderPlacement,
            FooterPlacement = overrides?.FooterPlacement,
            HeaderEdgeOffset = overrides?.HeaderEdgeOffset,
            FooterEdgeOffset = overrides?.FooterEdgeOffset,
            KeepTogether = keepTogether,
        };

        if (overrides != null)
        {
            EmitChromeReservationRemark(overrides);
        }

        BuildPreview(section);

        DA.SetData(0, section);
    }

    private static object Unwrap(IGH_Goo goo) => goo switch
    {
        null => null,
        GH_ObjectWrapper wrap => wrap.Value,
        _ => goo,
    };

    private void EmitChromeReservationRemark(LayoutOverride overrides)
    {
        if (overrides.Header == null && overrides.Footer == null) return;
        var parts = new List<string>(2);
        if (overrides.Header != null) parts.Add($"Header {DescribeReservation(overrides.Header, overrides.HeaderHeight)}");
        if (overrides.Footer != null) parts.Add($"Footer {DescribeReservation(overrides.Footer, overrides.FooterHeight)}");
        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, string.Join(" · ", parts));
    }

    private static string DescribeReservation(DrawElement chrome, double? input)
    {
        if (input.HasValue && input.Value > 0) return $"{input.Value:0.##} mm (explicit)";
        if (input.HasValue && input.Value == 0) return "0 mm (no reservation)";
        var resolved = PaginationPass.ResolveLayout(chrome);
        var measured = PaginationPass.ResolveBandHeight(null, resolved);
        return $"{measured:0.##} mm (auto)";
    }

    private void WarnIfChromeHasOrigin(DrawElement element, string slot)
    {
        if (element == null) return;
        var prop = element.GetType().GetProperty("Origin");
        if (prop == null) return;
        var value = prop.GetValue(element);
        if (value == null) return;
        var x = (double)value.GetType().GetProperty("X").GetValue(value);
        var y = (double)value.GetType().GetProperty("Y").GetValue(value);
        if (Math.Abs(x) < 1e-9 && Math.Abs(y) < 1e-9) return;
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
            $"{slot} element's Origin ({x:0.##}, {y:0.##}) is ignored — chrome is anchored to the page band. Use {slot} Align to control horizontal placement.");
    }

    // Connecting multiple elements directly to Page wraps them in a Group, which preserves
    // their world coordinates and is treated as one atomic block by pagination. That silently
    // hides content when children overlap or fall outside the margin box. Surface those
    // cases as warnings so the user knows to put a Stack/Grid in front.
    private void WarnOnDirectMultiElementLayout(List<DrawElement> children, PaperSize paper, Margins margins)
    {
        var marginBox = new ModelBoundingBox(
            margins.Left,
            margins.Bottom,
            Math.Max(margins.Left, paper.WidthMm - margins.Right),
            Math.Max(margins.Bottom, paper.HeightMm - margins.Top));

        var bounds = new ModelBoundingBox[children.Count];
        for (var i = 0; i < children.Count; i++) bounds[i] = SafeBounds(children[i]);

        var overlaps = 0;
        for (var i = 0; i < bounds.Length; i++)
        {
            if (bounds[i].IsEmpty) continue;
            for (var j = i + 1; j < bounds.Length; j++)
            {
                if (bounds[j].IsEmpty) continue;
                if (BoxesOverlap(bounds[i], bounds[j])) overlaps++;
            }
        }
        if (overlaps > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{children.Count} elements connected directly — {overlaps} overlapping pair(s) detected. Children keep world positions; use a Stack or Grid to flow them.");
        }

        var outside = 0;
        foreach (var b in bounds)
        {
            if (b.IsEmpty) continue;
            if (!BoxContains(marginBox, b)) outside++;
        }
        if (outside > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{outside} element(s) extend outside the page's margin box and will be clipped. Use a Stack to flow content across pages.");
        }
    }

    private static ModelBoundingBox SafeBounds(DrawElement element)
    {
        try { return element.ComputeBounds(); }
        catch { return ModelBoundingBox.Empty; }
    }

    private static bool BoxesOverlap(ModelBoundingBox a, ModelBoundingBox b) =>
        a.MinX < b.MaxX && a.MaxX > b.MinX && a.MinY < b.MaxY && a.MaxY > b.MinY;

    private static bool BoxContains(ModelBoundingBox outer, ModelBoundingBox inner) =>
        inner.MinX >= outer.MinX && inner.MaxX <= outer.MaxX &&
        inner.MinY >= outer.MinY && inner.MaxY <= outer.MaxY;

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

    public override void DrawViewportMeshes(IGH_PreviewArgs args) => DrawViewportWires(args);

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
}
