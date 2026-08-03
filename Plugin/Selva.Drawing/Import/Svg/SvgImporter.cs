using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Xml.Linq;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Import.Svg;

// ============================================================================
// Translates an SVG document into the DrawElement model so it renders losslessly
// to both SVG and PDF through the existing pipeline (no rasterisation). Vector
// line-art — paths, basic shapes, groups, transforms, solid fills/strokes — maps
// cleanly. Unsupported features (gradients, filters, clip-paths, text, embedded
// images) are skipped and reported via Warnings so the caller can surface them.
// ============================================================================
public sealed class SvgImporter
{
    private readonly List<string> _warnings = new List<string>();
    private readonly HashSet<string> _skippedKinds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<string> Warnings => _warnings;

    // Null if nothing usable was found.
    public DrawElement Import(string svgMarkup)
    {
        if (string.IsNullOrWhiteSpace(svgMarkup)) return null;

        XDocument doc;
        try
        {
            doc = XDocument.Parse(svgMarkup);
        }
        catch (Exception ex)
        {
            throw new FormatException($"Invalid SVG: {ex.Message}", ex);
        }

        var root = doc.Root;
        if (root == null || !root.Name.LocalName.Equals("svg", StringComparison.OrdinalIgnoreCase))
        {
            throw new FormatException("Root element is not <svg>");
        }

        var children = new List<DrawElement>();
        foreach (var child in root.Elements())
        {
            var el = ConvertElement(child, new SvgStyle());
            if (el != null) children.Add(el);
        }

        FlushSkippedWarning();

        if (children.Count == 0) return null;

        // SVG Y grows downward; the drawing model is Y-up. Flip about the document height
        // (viewBox/height when available) so imported art is upright in model space.
        var height = ResolveDocumentHeight(root, children);
        return new GroupElement
        {
            Transform = new Transform(1, 0, 0, -1, 0, height),
            Children = children,
        };
    }

    private DrawElement ConvertElement(XElement el, SvgStyle inherited)
    {
        var name = el.Name.LocalName.ToLowerInvariant();
        var style = inherited.InheritFrom(el);
        var transform = ParseTransform(el.Attribute("transform")?.Value);

        switch (name)
        {
            case "g":
            case "svg": // nested <svg> — treat as a group
            {
                var kids = new List<DrawElement>();
                foreach (var c in el.Elements())
                {
                    var converted = ConvertElement(c, style);
                    if (converted != null) kids.Add(converted);
                }
                if (kids.Count == 0) return null;
                return new GroupElement { Transform = transform, Children = kids };
            }

            case "path":
                return WrapPath(SvgPathDataParser.Parse(el.Attribute("d")?.Value), style, transform);

            case "rect":
                return WrapPath(BuildRect(el), style, transform);

            case "circle":
                return WrapPath(BuildEllipse(el, circle: true), style, transform);

            case "ellipse":
                return WrapPath(BuildEllipse(el, circle: false), style, transform);

            case "line":
                return WrapPath(BuildLine(el), style, transform);

            case "polyline":
                return WrapPath(BuildPoly(el, close: false), style, transform);

            case "polygon":
                return WrapPath(BuildPoly(el, close: true), style, transform);

            case "defs":
            case "title":
            case "desc":
            case "metadata":
            case "style":
                // Structural / non-rendered — silently ignore.
                return null;

            default:
                NoteSkipped(name);
                return null;
        }
    }

    private DrawElement WrapPath(Path path, SvgStyle style, Transform transform)
    {
        if (path == null || path.IsEmpty) return null;

        var element = new PathElement
        {
            Path = path,
            Fill = style.ToFill(),
            Stroke = style.ToStroke(),
        };

        if (transform.IsIdentity) return element;
        return new GroupElement { Transform = transform, Children = new DrawElement[] { element } };
    }

    // -------------------------------------------------------------------------
    // Shape → Path conversions
    // -------------------------------------------------------------------------

    private static Path BuildRect(XElement el)
    {
        var x = Num(el, "x");
        var y = Num(el, "y");
        var w = Num(el, "width");
        var h = Num(el, "height");
        if (w <= 0 || h <= 0) return Path.Empty;

        // Rounded corners (rx/ry) are flattened to a plain rectangle for now.
        return new Path.Builder()
            .MoveTo(x, y).LineTo(x + w, y).LineTo(x + w, y + h).LineTo(x, y + h).Close()
            .Build();
    }

    private static Path BuildEllipse(XElement el, bool circle)
    {
        double cx = Num(el, "cx"), cy = Num(el, "cy");
        double rx, ry;
        if (circle)
        {
            var r = Num(el, "r");
            rx = ry = r;
        }
        else
        {
            rx = Num(el, "rx");
            ry = Num(el, "ry");
        }
        if (rx <= 0 || ry <= 0) return Path.Empty;

        // Two 180° arcs make a full ellipse.
        return new Path.Builder()
            .MoveTo(cx - rx, cy)
            .ArcTo(new Point2D(cx + rx, cy), rx, ry, 0, false, true)
            .ArcTo(new Point2D(cx - rx, cy), rx, ry, 0, false, true)
            .Close()
            .Build();
    }

    private static Path BuildLine(XElement el)
    {
        return new Path.Builder()
            .MoveTo(Num(el, "x1"), Num(el, "y1"))
            .LineTo(Num(el, "x2"), Num(el, "y2"))
            .Build();
    }

    private static Path BuildPoly(XElement el, bool close)
    {
        var pts = ParsePoints(el.Attribute("points")?.Value);
        if (pts.Count < 2) return Path.Empty;

        var b = new Path.Builder().MoveTo(pts[0]);
        for (var i = 1; i < pts.Count; i++) b.LineTo(pts[i]);
        if (close) b.Close();
        return b.Build();
    }

    private static List<Point2D> ParsePoints(string s)
    {
        var result = new List<Point2D>();
        if (string.IsNullOrWhiteSpace(s)) return result;

        var nums = s.Split(new[] { ' ', ',', '\t', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i + 1 < nums.Length; i += 2)
        {
            if (double.TryParse(nums[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) &&
                double.TryParse(nums[i + 1], NumberStyles.Float, CultureInfo.InvariantCulture, out var y))
            {
                result.Add(new Point2D(x, y));
            }
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // transform="" parsing
    // -------------------------------------------------------------------------

    private static Transform ParseTransform(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return Transform.Identity;

        var result = Transform.Identity;
        var i = 0;
        while (i < value.Length)
        {
            var open = value.IndexOf('(', i);
            if (open < 0) break;
            var close = value.IndexOf(')', open);
            if (close < 0) break;

            var op = value.Substring(i, open - i).Trim();
            var args = value.Substring(open + 1, close - open - 1)
                .Split(new[] { ',', ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(a => double.TryParse(a, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0)
                .ToArray();

            var t = BuildTransformOp(op, args);
            // SVG applies transforms left-to-right (outermost first): result = result * t.
            result = result.Multiply(t);
            i = close + 1;
        }

        return result;
    }

    private static Transform BuildTransformOp(string op, double[] a)
    {
        switch (op.ToLowerInvariant())
        {
            case "translate":
                return Transform.Translate(a.Length > 0 ? a[0] : 0, a.Length > 1 ? a[1] : 0);
            case "scale":
                return a.Length > 1 ? Transform.Scale(a[0], a[1]) : Transform.Scale(a.Length > 0 ? a[0] : 1);
            case "rotate":
                if (a.Length >= 3)
                {
                    // rotate(angle cx cy) = translate(c) rotate translate(-c)
                    return Transform.Translate(a[1], a[2])
                        .Multiply(Transform.RotateDegrees(a[0]))
                        .Multiply(Transform.Translate(-a[1], -a[2]));
                }
                return Transform.RotateDegrees(a.Length > 0 ? a[0] : 0);
            case "matrix":
                return a.Length >= 6 ? new Transform(a[0], a[1], a[2], a[3], a[4], a[5]) : Transform.Identity;
            case "skewx":
                return new Transform(1, 0, Math.Tan((a.Length > 0 ? a[0] : 0) * Math.PI / 180), 1, 0, 0);
            case "skewy":
                return new Transform(1, Math.Tan((a.Length > 0 ? a[0] : 0) * Math.PI / 180), 0, 1, 0, 0);
            default:
                return Transform.Identity;
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static double ResolveDocumentHeight(XElement root, List<DrawElement> children)
    {
        var h = root.Attribute("height")?.Value;
        if (h != null && TryParseLength(h, out var height) && height > 0) return height;

        var viewBox = root.Attribute("viewBox")?.Value;
        if (viewBox != null)
        {
            var parts = viewBox.Split(new[] { ' ', ',' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 4 &&
                double.TryParse(parts[3], NumberStyles.Float, CultureInfo.InvariantCulture, out var vbh) && vbh > 0)
            {
                return vbh;
            }
        }

        // Fall back to the content's own extent.
        var bounds = BoundingBox.Empty;
        foreach (var c in children) bounds = bounds.Union(c.ComputeBounds());
        return bounds.IsEmpty ? 0 : bounds.MaxY;
    }

    private static bool TryParseLength(string s, out double value)
    {
        value = 0;
        if (string.IsNullOrWhiteSpace(s) || s.TrimEnd().EndsWith("%")) return false;
        var num = new string(s.TakeWhile(c => char.IsDigit(c) || c == '.' || c == '-' || c == '+').ToArray());
        return double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static double Num(XElement el, string attr)
    {
        var v = el.Attribute(attr)?.Value;
        return v != null && double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
    }

    private void NoteSkipped(string kind) => _skippedKinds.Add(kind);

    private void FlushSkippedWarning()
    {
        if (_skippedKinds.Count == 0) return;
        _warnings.Add($"SVG: skipped unsupported elements ({string.Join(", ", _skippedKinds.OrderBy(k => k))}). " +
                      "Paths, basic shapes, groups, transforms, and solid fills/strokes were imported.");
    }
}
