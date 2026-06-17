using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using ModelBoundingBox = Selva.Drawing.Model.Geometry.BoundingBox;
using DrawTransform = Selva.Drawing.Model.Geometry.Transform;
using Selva.GH.Properties;
using Selva.Drawing.RhinoInterop;

namespace Selva.GH.Features.Drawing.Components;

// Wraps drawing elements into a Section that flows into GH_Document. The section is the
// unrendered description; GH_Document drives pagination and global token resolution so
// page numbering is correct across multi-section documents.
//
// Arrange controls how the input is placed:
//   Auto (default) — each input tree BRANCH is one unit (its internal relative geometry kept
//     intact: a line and the dimension annotating it stay paired). Each branch's world offset
//     is stripped and the branches flow down the page, centred and spaced, inside the margins.
//     This is the painless default: drop drawings on a Page and they land sensibly.
//   Grid — branches packed into a fit-to-page grid (contact-sheet style).
//   Manual — branches keep their raw Rhino world coordinates (for deliberately positioned
//     layouts). Overlap / outside-margin warnings apply only in this mode.
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
            "Wraps drawing elements into a page that flows into a Document. Use a Layout Override for per-page paper / chrome.",
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
        pManager.AddGenericParameter("Drawings", "Dwg", "Drawing elements to place on the page(s). Each tree branch is one unit kept together (e.g. a drawing + its dimension); branches are arranged relative to each other per the Arrange mode.", GH_ParamAccess.tree);
        pManager.AddTextParameter("Title", "T", "Page title — surfaces via the {section} token in chrome and is stamped on each output page", GH_ParamAccess.item, string.Empty);
        pManager.AddGenericParameter("Override", "O", "Optional per-page overrides (paper, margins, chrome) from a Layout Override component. Leave unconnected to inherit everything from the Document.", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Keep Together", "KT", "When true, the entire section is forced onto a single page even if its content overflows.", GH_ParamAccess.item, false);
        pManager.AddIntegerParameter("Arrange", "Ar", "How to place the input. Auto = flow branches centred down the page (painless default). Grid = pack into a fit-to-page grid. Manual = keep raw Rhino world coordinates.", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Spacing", "Sp", "Gap between arranged branches, in mm (Auto / Grid modes).", GH_ParamAccess.item, 5.0);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;

        if (pManager[4] is Param_Integer arrange)
        {
            arrange.AddNamedValue("Auto", 0);
            arrange.AddNamedValue("Grid", 1);
            arrange.AddNamedValue("Manual", 2);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Page", "P", "Page to plug into a Document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var title = string.Empty;
        IGH_Goo overrideGoo = null;
        var keepTogether = false;
        var arrangeMode = 0;
        var spacing = 5.0;

        if (!DA.GetDataTree<IGH_Goo>(0, out GH_Structure<IGH_Goo> tree)) tree = new GH_Structure<IGH_Goo>();
        DA.GetData(1, ref title);
        DA.GetData(2, ref overrideGoo);
        DA.GetData(3, ref keepTogether);
        DA.GetData(4, ref arrangeMode);
        DA.GetData(5, ref spacing);

        var overrides = Unwrap(overrideGoo) as LayoutOverride;
        if (overrideGoo != null && overrides == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Override input must be a Layout Override value — ignoring.");
        }

        WarnIfChromeHasOrigin(overrides?.Header, "Header");
        WarnIfChromeHasOrigin(overrides?.Footer, "Footer");

        // Each branch becomes one unit. A single-element branch is that element; a multi-element
        // branch is Grouped so its internal relative geometry (drawing + its dimension) is kept.
        var branches = BuildBranchUnits(tree, out var skipped);
        if (skipped > 0)
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Skipped {skipped} input(s) that are not drawing elements");

        if (branches.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No content provided");
            return;
        }

        spacing = Math.Max(0, spacing);
        DrawElement content = arrangeMode switch
        {
            2 => ComposeManual(branches, overrides),     // raw world coords (legacy behaviour)
            1 => ComposeGrid(branches, spacing),         // fit-to-page grid
            _ => ComposeAuto(branches, spacing),         // centred vertical flow (default)
        };

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

        // When the section feeds a Document, the Document previews the real pages (global
        // numbering, document chrome) at the same world origin — drawing both superimposes
        // two conflicting previews. Only preview dangling Page components.
        if (Params.Output[0].Recipients.Count == 0)
            BuildPreview(section);

        DA.SetData(0, section);
    }

    // One unit per branch. Single-element branch → that element; multi-element branch → a Group
    // preserving the children's relative world geometry so an annotation stays with its drawing.
    private static List<DrawElement> BuildBranchUnits(GH_Structure<IGH_Goo> tree, out int skipped)
    {
        skipped = 0;
        var units = new List<DrawElement>(tree.PathCount);
        foreach (var path in tree.Paths)
        {
            var branch = tree.get_Branch(path);
            var elems = new List<DrawElement>(branch.Count);
            foreach (var item in branch)
            {
                if (item is GH_ObjectWrapper wrap && wrap.Value is DrawElement de) elems.Add(de);
                else if (item is DrawElement direct) elems.Add(direct);
                else if (item != null) skipped++;
            }
            if (elems.Count == 0) continue;
            units.Add(elems.Count == 1 ? elems[0] : new GroupElement { Children = elems });
        }
        return units;
    }

    // Auto: strip each branch's world offset (so a branch drawn far from origin lands on the
    // sheet, not at its Rhino coordinates) and flow them centred down the page. Pagination and
    // page-fitting are handled downstream by the Stack + Document.
    private static DrawElement ComposeAuto(List<DrawElement> branches, double spacing)
    {
        if (branches.Count == 1) return NormalizeToOrigin(branches[0]);

        var normalized = new List<DrawElement>(branches.Count);
        foreach (var b in branches) normalized.Add(NormalizeToOrigin(b));

        return new Stack
        {
            Children = normalized,
            Orientation = StackOrientation.Vertical,
            Spacing = spacing,
            CrossAlign = CrossAlign.Center,
        };
    }

    // Grid: pack normalized branches into a near-square grid of equal (star) tracks that fills
    // the page width. Row count follows from the column count so the sheet reads as a contact
    // sheet of the branches.
    private DrawElement ComposeGrid(List<DrawElement> branches, double spacing)
    {
        if (branches.Count == 1) return NormalizeToOrigin(branches[0]);

        var cols = (int)Math.Ceiling(Math.Sqrt(branches.Count));
        var rows = (int)Math.Ceiling(branches.Count / (double)cols);

        var colTracks = new GridLength[cols];
        for (var c = 0; c < cols; c++) colTracks[c] = GridLength.Star();
        var rowTracks = new GridLength[rows];
        for (var r = 0; r < rows; r++) rowTracks[r] = GridLength.Auto;

        var cells = new List<GridCell>(branches.Count);
        for (var i = 0; i < branches.Count; i++)
        {
            cells.Add(new GridCell
            {
                Row = i / cols,
                Column = i % cols,
                Content = NormalizeToOrigin(branches[i]),
            });
        }

        return new Grid
        {
            Columns = colTracks,
            Rows = rowTracks,
            Cells = cells,
            ColumnSpacing = spacing,
            RowSpacing = spacing,
        };
    }

    // Manual: legacy behaviour — keep raw world coordinates, Group multi-branch input, and warn
    // when content overlaps or falls outside the margins so the user can correct positions.
    private DrawElement ComposeManual(List<DrawElement> branches, LayoutOverride overrides)
    {
        if (branches.Count > 1)
            WarnOnDirectMultiElementLayout(
                branches,
                overrides?.PaperSize ?? PaperSize.A4,
                overrides?.Margins ?? Margins.Uniform(10),
                paperKnown: overrides?.PaperSize != null);

        return branches.Count == 1 ? branches[0] : new GroupElement { Children = branches };
    }

    // Shift an element so its bounding box's bottom-left sits at the origin, discarding the
    // world offset it inherited from where it was drawn in Rhino. Empty/degenerate bounds pass
    // through unchanged.
    private static DrawElement NormalizeToOrigin(DrawElement element)
    {
        if (element == null) return null;
        var b = SafeBounds(element);
        if (b.IsEmpty) return element;
        if (Math.Abs(b.MinX) < 1e-9 && Math.Abs(b.MinY) < 1e-9) return element;
        return new GroupElement
        {
            Transform = DrawTransform.Translate(-b.MinX, -b.MinY),
            Children = new[] { element },
        };
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
    private void WarnOnDirectMultiElementLayout(List<DrawElement> children, PaperSize paper, Margins margins, bool paperKnown)
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
            // Without a section override the real paper comes from the Document downstream —
            // a hard warning against assumed A4 would regularly be wrong in both directions.
            if (paperKnown)
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"{outside} element(s) extend outside the page's margin box and will be clipped. Use a Stack to flow content across pages.");
            else
                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                    $"{outside} element(s) extend outside an assumed A4 margin box — actual paper size is set by the Document downstream.");
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

        // Accumulate across solve instances (list-matched inputs produce one section per
        // instance) — assignment here would leave only the last instance's pages visible.
        // ClearData resets the lists before the next solve.
        _previewPages ??= new List<Page>();
        _previewContents ??= new List<DrawElement>();
        foreach (var p in pages)
        {
            _previewPages.Add(p);
            var resolved = LayoutPass.ResolvePage(p);
            _previewContents.Add(resolved?.Content);
        }
        _clippingBox = ComputeClippingBox(_previewPages);
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

    // Everything (wires, text, shaded fills) is drawn in the wires pass — repeating it in
    // the mesh pass doubled preview cost and composited transparent fills twice.
    public override void DrawViewportMeshes(IGH_PreviewArgs args) { }

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
