using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;
using Selva.Drawing.RhinoInterop;

namespace Selva.GH.Features.Drawing.Components;

// Section overrides win for that section's pages; everything else inherits the document
// defaults (A4, 10mm, Left, Margin placement) unless a Layout Override is wired in.
// Page numbering is global: two sections of 2 + 3 pages read "1/5"…"5/5".
public class GH_Document : GH_Component
{
    private List<Page> _previewPages;
    private List<DrawElement> _previewContents;
    private BoundingBox _clippingBox = BoundingBox.Empty;

    // Stamped once per instance so identical inputs produce identical Documents across
    // recomputes: DateTime.UtcNow per solve made every recompute a "new" file.
    private readonly DateTime _createdAt = DateTime.UtcNow;

    private const double TileGapMm = 20.0;

    public GH_Document()
        : base("Document", "Doc",
            "Bundles pages into a paginated document with shared metadata. Wire a Layout Override for non-default paper / chrome.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.Document;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("5D1CF967-D40D-412E-AA63-4D081419BDF3");

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
        pManager.AddGenericParameter("Pages", "P", "Pages to assemble into the document, in order", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "Document title — surfaces via the {title} token and as PDF metadata", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Author", "A", "Document author (PDF /Info)", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Subject", "Sj", "Document subject (PDF /Info)", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Keywords", "K", "Comma-separated keyword list (PDF /Info)", GH_ParamAccess.list);
        pManager.AddGenericParameter("Override", "O", "Optional document-wide layout (paper, margins, chrome) from a Layout Override component. Leave unconnected to use built-in defaults (A4, 10mm margins, no chrome).", GH_ParamAccess.item);
        pManager.AddGenericParameter("Info", "I", "Optional Document Info — your own reusable {token} values. Wire a Document Info component (Keys = [\"project\",\"client\"], Values = [\"Villa A\",\"Acme\"]) and then any header/footer/cell text containing {project} or {client} gets replaced. Built-in tokens ({title} {date} {page} {pages} {section} {scale}) always work without this.", GH_ParamAccess.item);
        pManager.AddTextParameter("Culture", "C", "Language/region code for the {date} token's month and day NAMES, e.g. \"de-DE\" (Juni, Dienstag), \"fr-FR\", \"en-US\". Default en-US. Numeric formats like {date:dd.MM.yyyy} look the same in every culture — switch this only when you use month/day names like {date:d. MMMM yyyy}.", GH_ParamAccess.item, "en-US");

        for (var i = 1; i <= 7; i++) pManager[i].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Document", "D", "Drawing document, ready for renderers", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var sections = new List<Section>();
        var title = string.Empty;
        var author = string.Empty;
        var subject = string.Empty;
        var keywords = new List<string>();
        IGH_Goo overrideGoo = null;
        IGH_Goo infoGoo = null;
        var cultureCode = "en-US";

        DA.GetDataList(0, sections);
        DA.GetData(1, ref title);
        DA.GetData(2, ref author);
        DA.GetData(3, ref subject);
        DA.GetDataList(4, keywords);
        DA.GetData(5, ref overrideGoo);
        DA.GetData(6, ref infoGoo);
        DA.GetData(7, ref cultureCode);

        var overrides = Unwrap(overrideGoo) as LayoutOverride;
        if (overrideGoo != null && overrides == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Override input must be a Layout Override value — ignoring.");
        }

        var info = Unwrap(infoGoo) as DocumentInfo;
        if (infoGoo != null && info == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                "Info input must be a Document Info value — ignoring.");
        }

        WarnIfChromeHasOrigin(overrides?.Header, "Header");
        WarnIfChromeHasOrigin(overrides?.Footer, "Footer");

        var validSections = new List<Section>(sections.Count);
        foreach (var s in sections) if (s != null) validSections.Add(s);

        if (validSections.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No sections provided");
            return;
        }

        var paper = overrides?.PaperSize ?? PaperSize.A4;
        var margins = overrides?.Margins ?? Margins.Uniform(10);

        var layout = new DocumentLayout
        {
            Sections = validSections,
            Title = title,
            PaperSize = paper,
            Margins = margins,
            Header = overrides?.Header,
            Footer = overrides?.Footer,
            HeaderHeight = overrides?.HeaderHeight,
            FooterHeight = overrides?.FooterHeight,
            HeaderAlign = overrides?.HeaderAlign ?? HorizontalAlign.Left,
            FooterAlign = overrides?.FooterAlign ?? HorizontalAlign.Left,
            HeaderPlacement = overrides?.HeaderPlacement ?? ChromePlacement.Margin,
            FooterPlacement = overrides?.FooterPlacement ?? ChromePlacement.Margin,
            HeaderEdgeOffset = overrides?.HeaderEdgeOffset ?? 0,
            FooterEdgeOffset = overrides?.FooterEdgeOffset ?? 0,
            Tokens = info?.Tokens,
            Culture = ResolveCulture(cultureCode),
        };

        if (overrides != null) EmitChromeReservationRemark(overrides);

        var pages = DocumentLayoutPass.Paginate(layout);

        var keywordList = keywords.Count > 0 ? keywords.ToArray() : null;
        var doc = new Document
        {
            Pages = pages,
            Metadata = new DocumentMetadata
            {
                Title = NullIfEmpty(title),
                Author = NullIfEmpty(author),
                Subject = NullIfEmpty(subject),
                Keywords = keywordList,
                Creator = "Selva",
                Producer = "Selva.Drawing",
                CreatedAt = _createdAt,
            },
        };

        BuildPreview(pages);

        DA.SetData(0, doc);
    }

    private static object Unwrap(IGH_Goo goo) => goo switch
    {
        null => null,
        GH_ObjectWrapper wrap => wrap.Value,
        _ => goo,
    };

    private void BuildPreview(IReadOnlyList<Page> pages)
    {
        // Accumulate rather than assign: assignment would leave only the last document's
        // pages visible.
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

    // Surfaces what pagination actually reserved, so the user isn't guessing whether
    // 0 / -1 / a positive height did what they expected.
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

    // AnchorChrome overwrites the element's Origin; warn instead of leaving users to wonder
    // why a carefully positioned header block snapped somewhere else.
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
            var label = $"{i + 1}/{_previewPages.Count} · {page.Size.Name ?? $"{w:0}×{h:0}mm"}";
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

    // Wires, text, and shaded fills all draw in the wires pass; repeating in the mesh pass
    // doubled preview cost and composited transparent fills twice.
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

    private static string NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;

    // Empty or invalid code falls back to invariant (English); warns on an unrecognised code.
    private System.Globalization.CultureInfo ResolveCulture(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return System.Globalization.CultureInfo.InvariantCulture;
        try
        {
            return System.Globalization.CultureInfo.GetCultureInfo(code.Trim());
        }
        catch (System.Globalization.CultureNotFoundException)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Culture \"{code}\" is not recognised — falling back to English. Use a code like \"de-DE\", \"fr-FR\", or \"en-US\".");
            return System.Globalization.CultureInfo.InvariantCulture;
        }
    }
}
