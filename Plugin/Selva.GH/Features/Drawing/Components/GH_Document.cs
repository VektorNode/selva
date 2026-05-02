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

// Owns the document-wide chrome (Header, Footer, Title, Tokens, default paper / margins) and
// drives pagination + token resolution across every section. Section overrides win for that
// section's pages; everything else inherits from these inputs.
//
// Page numbering is global: a document with two sections of 2 + 3 pages reads "1/5"…"5/5".
//
// Header / Footer accept any DrawElement. TextElement / TextBlockElement nodes inside them
// can use tokens — built-ins {page}, {pages}, {section}, {title}, {date} (or {date:fmt}),
// plus any user-defined tokens supplied via the parallel Token Keys / Token Values inputs.
public class GH_Document : GH_Component
{
    private List<Page> _previewPages;
    private List<DrawElement> _previewContents;
    private BoundingBox _clippingBox = BoundingBox.Empty;

    private const double TileGapMm = 20.0;

    public GH_Document()
        : base("Document", "Doc",
            "Bundles sections into a paginated document with shared chrome and metadata. Page numbering is global across all sections.",
            "Selva", "Document")
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
        pManager.AddGenericParameter("Sections", "S", "Sections to assemble into the document, in order", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "Document title — surfaces via the {title} token and as PDF metadata", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Author", "A", "Document author (PDF /Info)", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Subject", "Sj", "Document subject (PDF /Info)", GH_ParamAccess.item, string.Empty);
        pManager.AddTextParameter("Keywords", "K", "Comma-separated keyword list (PDF /Info)", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Paper Size", "PS", "Default paper size for sections that don't override", GH_ParamAccess.item, 4);
        pManager.AddBooleanParameter("Landscape", "L", "Rotate the default paper to landscape", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Margin", "M", "Default uniform page margin in millimetres", GH_ParamAccess.item, 10.0);
        pManager.AddGenericParameter("Header", "H", "Drawing element repeated at the top of every page that doesn't override (supports tokens)", GH_ParamAccess.item);
        pManager.AddGenericParameter("Footer", "F", "Drawing element repeated at the bottom of every page that doesn't override", GH_ParamAccess.item);
        pManager.AddNumberParameter("Header Height", "HH", "Reserved header height in mm. 0 measures from header bounds.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Footer Height", "FH", "Reserved footer height in mm. 0 measures from footer bounds.", GH_ParamAccess.item, 0.0);
        pManager.AddTextParameter("Token Keys", "TK", "User-defined token names. Parallel to Token Values. Built-ins (page, pages, section, title, date) win on collision.", GH_ParamAccess.list);
        pManager.AddTextParameter("Token Values", "TV", "User-defined token values, parallel to Token Keys.", GH_ParamAccess.list);

        for (var i = 1; i <= 13; i++) pManager[i].Optional = true;

        if (pManager[5] is Param_Integer paperParam)
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
        pManager.AddGenericParameter("Document", "D", "Drawing document, ready for renderers", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var sections = new List<Section>();
        var title = string.Empty;
        var author = string.Empty;
        var subject = string.Empty;
        var keywords = new List<string>();
        var paperIndex = 4;
        var landscape = false;
        var margin = 10.0;
        DrawElement header = null;
        DrawElement footer = null;
        var headerHeight = 0.0;
        var footerHeight = 0.0;
        var tokenKeys = new List<string>();
        var tokenValues = new List<string>();

        DA.GetDataList(0, sections);
        DA.GetData(1, ref title);
        DA.GetData(2, ref author);
        DA.GetData(3, ref subject);
        DA.GetDataList(4, keywords);
        DA.GetData(5, ref paperIndex);
        DA.GetData(6, ref landscape);
        DA.GetData(7, ref margin);
        DA.GetData(8, ref header);
        DA.GetData(9, ref footer);
        DA.GetData(10, ref headerHeight);
        DA.GetData(11, ref footerHeight);
        DA.GetDataList(12, tokenKeys);
        DA.GetDataList(13, tokenValues);

        var validSections = new List<Section>(sections.Count);
        foreach (var s in sections) if (s != null) validSections.Add(s);

        if (validSections.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No sections provided");
            return;
        }

        var paper = ResolvePaper(paperIndex);
        if (landscape) paper = paper.Landscape();
        var margins = Margins.Uniform(Math.Max(0, margin));

        var userTokens = BuildTokenMap(tokenKeys, tokenValues);

        var layout = new DocumentLayout
        {
            Sections = validSections,
            Title = title,
            PaperSize = paper,
            Margins = margins,
            Header = header,
            Footer = footer,
            HeaderHeight = headerHeight > 0 ? headerHeight : (double?)null,
            FooterHeight = footerHeight > 0 ? footerHeight : (double?)null,
            Tokens = userTokens,
        };

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
                CreatedAt = DateTime.UtcNow,
            },
        };

        BuildPreview(pages);

        DA.SetData(0, doc);
    }

    private void BuildPreview(IReadOnlyList<Page> pages)
    {
        _previewPages = new List<Page>(pages);
        _previewContents = new List<DrawElement>(pages.Count);
        foreach (var p in pages)
        {
            var resolved = LayoutPass.ResolvePage(p);
            _previewContents.Add(resolved?.Content);
        }
        _clippingBox = ComputeClippingBox(pages);
    }

    private IReadOnlyDictionary<string, string> BuildTokenMap(IList<string> keys, IList<string> values)
    {
        if (keys == null || values == null || keys.Count == 0) return null;

        if (keys.Count != values.Count)
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Token Keys and Token Values have different lengths ({keys.Count} vs {values.Count}); using the shorter list");

        var n = Math.Min(keys.Count, values.Count);
        if (n == 0) return null;

        var map = new Dictionary<string, string>(n, StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < n; i++)
        {
            var k = keys[i];
            if (string.IsNullOrWhiteSpace(k)) continue;
            map[k] = values[i] ?? string.Empty;
        }
        return map.Count == 0 ? null : map;
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

    private static string NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;
}
