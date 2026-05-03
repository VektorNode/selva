using System;
using System.Collections.Generic;
using System.Drawing;
using Rhino.Display;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using DrawColor = Selva.Drawing.Model.Style.Color;
using DrawColorSpace = Selva.Drawing.Model.Style.ColorSpace;
using DrawTransform = Selva.Drawing.Model.Geometry.Transform;
using DrawPath = Selva.Drawing.Model.Geometry.Path;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;
using DrawBox = Selva.Drawing.Model.Geometry.BoundingBox;
using PathSeg = Selva.Drawing.Model.Geometry.PathSegment;

namespace Selva.GH.Features.Drawing.Preview;

// Walks a Selva.Drawing element tree and renders the document into a Rhino viewport.
// Lives in Selva.GH (not Selva.Drawing) so the model layer stays free of RhinoCommon.
// Aims to mirror SvgRenderer's visual output: closed paths fill, strokes honor color and
// dashes, elliptical arcs are tessellated via SVG's center-parameterization, and hatches
// emit Lines/CrossHatch/Dots patterns. Images still show a placeholder rectangle and text
// metrics will not match a browser exactly (Rhino's display fonts differ from SVG glyphs).
internal sealed class RhinoViewportVisitor : IElementVisitor
{
    private static readonly Color StrokeFallback = Color.FromArgb(40, 40, 40);
    private static readonly Color FillOutlineFallback = Color.FromArgb(120, 120, 120);
    private static readonly Color TextColor = Color.FromArgb(20, 20, 20);
    private static readonly Color DimColor = Color.FromArgb(170, 70, 70);
    private static readonly Color HatchColor = Color.FromArgb(120, 120, 200);
    private static readonly Color BoxColor = Color.FromArgb(190, 190, 190);
    private static readonly Color LayoutBoundsColor = Color.FromArgb(120, 170, 220);

    private readonly DisplayPipeline _display;
    private DrawTransform _current = DrawTransform.Identity;

    public RhinoViewportVisitor(DisplayPipeline display)
    {
        _display = display ?? throw new ArgumentNullException(nameof(display));
    }

    public void Render(DrawElement root) => root?.Accept(this);

    // ============================================================================
    // IElementVisitor
    // ============================================================================

    public void Visit(GroupElement element)
    {
        if (element == null) return;
        var saved = _current;
        if (!element.Transform.IsIdentity) _current = _current.Multiply(element.Transform);
        // BoundsOverride is set by layout primitives (Grid, Frame, Table, TitleBlock, etc.)
        // when the resolved group's outer extent is wider than the union of its children.
        // Drawing those rects in the viewport gives a "show your layout" overlay for free —
        // SVG/PDF renderers don't run this visitor, so the final output is unaffected.
        if (element.BoundsOverride.HasValue)
            DrawDottedBox(element.BoundsOverride.Value, LayoutBoundsColor);
        foreach (var child in element.Children) child?.Accept(this);
        _current = saved;
    }

    public void Visit(PathElement element)
    {
        if (element == null || element.Path.IsEmpty) return;

        var subpaths = TessellateSubpaths(element.Path);

        // Fill closed subpaths first so strokes draw on top (matches SVG paint order).
        if (element.Fill != null)
        {
            var fillColor = ApplyOpacity(ToSystemColor(element.Fill.Color, FillOutlineFallback), element.Fill.Opacity);
            foreach (var sp in subpaths)
                if (sp.Closed && sp.Points.Count >= 3)
                    _display.DrawPolygon(sp.Points, fillColor, filled: true);
        }

        if (element.Stroke != null)
        {
            var strokeColor = ApplyOpacity(ToSystemColor(element.Stroke.Color, StrokeFallback), element.Stroke.Opacity);
            var thickness = StrokeThickness(element.Stroke.Width);
            var dashed = element.Stroke.DashArray != null && element.Stroke.DashArray.Count > 0;

            foreach (var sp in subpaths)
            {
                if (sp.Points.Count < 2) continue;
                if (dashed) DrawDashedPolyline(sp.Points, strokeColor);
                else _display.DrawPolyline(sp.Points, strokeColor, thickness);
            }
        }
        else if (element.Fill == null)
        {
            // Unstyled path: draw outline so the geometry is at least visible in preview.
            foreach (var sp in subpaths)
                if (sp.Points.Count >= 2)
                    _display.DrawPolyline(sp.Points, StrokeFallback, 1);
        }
    }

    public void Visit(TextElement element)
    {
        if (element == null) return;

        var text = element.Text;
        if (string.IsNullOrEmpty(text)) return;

        var style = element.Style;
        var size = style?.FontSize ?? 2.5;
        if (size <= 0) return;

        // Background mirrors the SVG/PDF output: derived from FontMetrics so the preview
        // matches what gets exported. The heuristic for unbundled families (e.g. "Arial")
        // won't perfectly match Rhino's display glyphs, but it's faithful to the output.
        if (element.Background.HasValue)
            DrawTextBackground(element);

        var pos = Map(element.Position);
        var plane = new Plane(pos, Vector3d.XAxis, Vector3d.YAxis);
        if (element.RotationDegrees != 0)
            plane.Rotate(element.RotationDegrees * Math.PI / 180.0, Vector3d.ZAxis, pos);

        // Draw3dText(string, color, plane, size, font) centers the run on the plane origin,
        // ignoring our anchors. Build a Text3d so HorizontalAlignment / VerticalAlignment
        // are respected and the glyph run sits on the actual Position.
        var fontFace = ResolveFontFace(style?.FontFamily);
        // Two corrections turn the model FontSize into a Rhino-world Text3d height:
        //   1. capRatio (~0.7): Rhino sizes by cap-height while SVG/PDF size by em.
        //   2. transformScale: DrawingView pre-multiplies FontSize by 1/effectiveScale so
        //      that the SVG/PDF group transform cancels it back to paper-space mm. Rhino's
        //      Text3d ignores the parent transform — apply the scale here so preview text
        //      ends up at the same visible size as the exported output.
        var capRatio = CapHeightToEmRatio(style);
        var transformScale = UniformScale(_current);
        var t3d = new Rhino.Display.Text3d(text, plane, size * capRatio * transformScale) { FontFace = fontFace };
        t3d.HorizontalAlignment = ToRhinoHAlign(style?.HorizontalAnchor ?? Selva.Drawing.Model.Style.TextAnchor.Left);
        t3d.VerticalAlignment = ToRhinoVAlign(style?.VerticalAnchor ?? Selva.Drawing.Model.Style.VerticalAnchor.Baseline);
        _display.Draw3dText(t3d, TextColor);
        t3d.Dispose();
    }

    // Ratio of cap-height to em for the resolved font. Rhino's Text3d sizes by cap-height
    // while SVG/PDF size by em — without this correction, preview glyphs come out ~1.4×
    // bigger than the exported output. Uses bundled font metrics when available, falls
    // back to the heuristic 0.7 for unbundled families.
    private static double CapHeightToEmRatio(Selva.Drawing.Model.Style.TextStyle style)
    {
        const double fallback = 0.7;
        if (style == null || style.FontSize <= 0) return fallback;
        var measured = Selva.Drawing.Fonts.FontMetrics.Measure("H", style);
        if (measured.CapHeight <= 0) return fallback;
        return measured.CapHeight / style.FontSize;
    }

    // The first family in a CSS-style stack ("Inter, Helvetica, sans-serif" → "Inter").
    // Matches FontMetrics.ExtractFirstFamily, which is what the SVG/PDF renderers measure
    // against — so the preview's glyph metrics line up with the background rect we draw.
    private static string ResolveFontFace(string fontFamily)
    {
        if (string.IsNullOrEmpty(fontFamily)) return "Inter";
        var comma = fontFamily.IndexOf(',');
        var first = comma < 0 ? fontFamily : fontFamily.Substring(0, comma);
        return first.Trim().Trim('"', '\'');
    }

    private static Rhino.DocObjects.TextHorizontalAlignment ToRhinoHAlign(Selva.Drawing.Model.Style.TextAnchor a)
    {
        switch (a)
        {
            case Selva.Drawing.Model.Style.TextAnchor.Center: return Rhino.DocObjects.TextHorizontalAlignment.Center;
            case Selva.Drawing.Model.Style.TextAnchor.Right: return Rhino.DocObjects.TextHorizontalAlignment.Right;
            default: return Rhino.DocObjects.TextHorizontalAlignment.Left;
        }
    }

    private static Rhino.DocObjects.TextVerticalAlignment ToRhinoVAlign(Selva.Drawing.Model.Style.VerticalAnchor a)
    {
        switch (a)
        {
            case Selva.Drawing.Model.Style.VerticalAnchor.Top: return Rhino.DocObjects.TextVerticalAlignment.Top;
            case Selva.Drawing.Model.Style.VerticalAnchor.Middle: return Rhino.DocObjects.TextVerticalAlignment.Middle;
            case Selva.Drawing.Model.Style.VerticalAnchor.Bottom: return Rhino.DocObjects.TextVerticalAlignment.BottomOfBoundingBox;
            // Baseline maps closest to Rhino's "Bottom" (baseline of bottom line of text).
            default: return Rhino.DocObjects.TextVerticalAlignment.Bottom;
        }
    }

    // Filled background behind a TextElement. Mirrors SvgRenderer.AppendTextBackgroundRect
    // so the preview shows what the SVG/PDF will export. Rhino's DisplayPipeline has no
    // rounded-rect helper, so corner radius is ignored in preview — final output honors it.
    private void DrawTextBackground(TextElement element)
    {
        var style = element.Style ?? new Selva.Drawing.Model.Style.TextStyle();
        var measured = Selva.Drawing.Fonts.FontMetrics.Measure(element.Text ?? string.Empty, style);
        var width = measured.Width;
        var ascent = measured.Ascent;
        var descent = Math.Abs(measured.Descent);
        var lineHeightMultiplier = Math.Max(1.0, style.LineHeight);
        var extra = (ascent + descent) * (lineHeightMultiplier - 1.0) * 0.5;
        ascent += extra;
        descent += extra;

        double localX;
        switch (style.HorizontalAnchor)
        {
            case Selva.Drawing.Model.Style.TextAnchor.Center: localX = -width / 2.0; break;
            case Selva.Drawing.Model.Style.TextAnchor.Right: localX = -width; break;
            default: localX = 0; break;
        }
        // Match SvgRenderer's dominant-baseline=middle convention: visual middle at y=0.
        var height = ascent + descent;
        var localY = -height / 2.0;

        var p = element.BackgroundPadding;
        if (p > 0)
        {
            localX -= p; localY -= p;
            width += 2 * p; height += 2 * p;
        }

        var cos = 1.0; var sin = 0.0;
        if (element.RotationDegrees != 0)
        {
            var rad = element.RotationDegrees * Math.PI / 180.0;
            cos = Math.Cos(rad); sin = Math.Sin(rad);
        }

        DrawPoint Local(double lx, double ly)
        {
            var rx = lx * cos - ly * sin;
            var ry = lx * sin + ly * cos;
            return new DrawPoint(element.Position.X + rx, element.Position.Y + ry);
        }

        var p1 = Map(Local(localX, localY));
        var p2 = Map(Local(localX + width, localY));
        var p3 = Map(Local(localX + width, localY + height));
        var p4 = Map(Local(localX, localY + height));

        var bgColor = ToSystemColor(element.Background.Value, Color.Transparent);
        _display.DrawPolygon(new[] { p1, p2, p3, p4 }, bgColor, filled: true);
    }

    public void Visit(TextBlockElement element)
    {
        if (element == null) return;
        if (string.IsNullOrEmpty(element.Text)) return;
        var size = element.Style?.FontSize ?? 2.5;
        if (size <= 0) return;

        // Anchor the text run at the box's top-left, matching SvgRenderer's TextBlockElement fallback.
        var pos = Map(new DrawPoint(element.Box.MinX, element.Box.MaxY - size));
        var plane = new Plane(pos, Vector3d.XAxis, Vector3d.YAxis);
        _display.Draw3dText(element.Text, TextColor, plane, size, "Arial");
    }

    public void Visit(ImageElement element)
    {
        if (element == null) return;
        var b = element.ComputeBounds();
        if (b.IsEmpty) return;

        DrawBoxOutline(b, BoxColor);
        // Diagonal cross to mark the slot as an image placeholder.
        _display.DrawLine(new Line(Map(new DrawPoint(b.MinX, b.MinY)), Map(new DrawPoint(b.MaxX, b.MaxY))), BoxColor);
        _display.DrawLine(new Line(Map(new DrawPoint(b.MinX, b.MaxY)), Map(new DrawPoint(b.MaxX, b.MinY))), BoxColor);
    }

    public void Visit(DimensionElement element)
    {
        if (element == null) return;
        switch (element.Kind)
        {
            case DimensionKind.Linear: DrawLinearDim(element); break;
            case DimensionKind.Angular: DrawAngularDim(element); break;
        }
    }

    public void Visit(LeaderElement element)
    {
        if (element == null || element.Points.Count < 2) return;

        var pts = new List<Point3d>(element.Points.Count);
        foreach (var p in element.Points) pts.Add(Map(p));
        _display.DrawPolyline(new Polyline(pts), DimColor, 1);

        if (!string.IsNullOrEmpty(element.Text))
        {
            var size = element.TextStyle?.FontSize ?? 2.5;
            if (size > 0)
            {
                var anchor = Map(element.Points[element.Points.Count - 1]);
                var plane = new Plane(anchor, Vector3d.XAxis, Vector3d.YAxis);
                _display.Draw3dText(element.Text, DimColor, plane, size, "Arial");
            }
        }
    }

    public void Visit(HatchElement element)
    {
        if (element == null || element.Boundary.IsEmpty) return;

        var subpaths = TessellateSubpaths(element.Boundary);
        var lineColor = element.LineStyle != null
            ? ApplyOpacity(ToSystemColor(element.LineStyle.Color, HatchColor), element.LineStyle.Opacity)
            : HatchColor;

        // Optional background fill behind the pattern.
        if (element.BackgroundColor.A > 0)
        {
            var bg = ToSystemColor(element.BackgroundColor, Color.Transparent);
            foreach (var sp in subpaths)
                if (sp.Closed && sp.Points.Count >= 3)
                    _display.DrawPolygon(sp.Points, bg, filled: true);
        }

        // Always trace the boundary so the region is legible even when the pattern is sparse.
        foreach (var sp in subpaths)
            if (sp.Points.Count >= 2)
                _display.DrawPolyline(sp.Points, lineColor, 1);

        if (element.Pattern == HatchPatternKind.Solid)
        {
            foreach (var sp in subpaths)
                if (sp.Closed && sp.Points.Count >= 3)
                    _display.DrawPolygon(sp.Points, lineColor, filled: true);
            return;
        }

        var spacing = element.Spacing > 0 ? element.Spacing : 2.0;
        var bounds = element.Boundary.ComputeBounds();
        if (bounds.IsEmpty) return;

        switch (element.Pattern)
        {
            case HatchPatternKind.Lines:
                DrawHatchLines(subpaths, bounds, element.AngleDegrees, spacing, lineColor);
                break;
            case HatchPatternKind.CrossHatch:
                DrawHatchLines(subpaths, bounds, element.AngleDegrees, spacing, lineColor);
                DrawHatchLines(subpaths, bounds, element.AngleDegrees + 90, spacing, lineColor);
                break;
            case HatchPatternKind.Dots:
                DrawHatchDots(subpaths, bounds, spacing, lineColor);
                break;
        }
    }

    public void Visit(SymbolElement element)
    {
        if (element?.Definition == null) return;
        var saved = _current;

        // SymbolElement convention (matches SvgRenderer): translate to Position, then apply Transform.
        var translate = DrawTransform.Translate(element.Position.X, element.Position.Y);
        var local = element.Transform.IsIdentity ? translate : translate.Multiply(element.Transform);
        _current = _current.Multiply(local);

        foreach (var child in element.Definition.Children) child?.Accept(this);

        _current = saved;
    }

    // ============================================================================
    // Helpers
    // ============================================================================

    private Point3d Map(DrawPoint p)
    {
        var t = _current.Apply(p);
        return new Point3d(t.X, t.Y, 0);
    }

    // Uniform-scale factor of an affine transform: sqrt(|det|). Used to scale paper-space
    // lengths (font size, etc.) that the model has pre-multiplied by 1/scale to survive a
    // group transform — SVG/PDF apply the transform to glyphs, Rhino Text3d does not.
    private static double UniformScale(DrawTransform t)
    {
        var det = t.A * t.D - t.B * t.C;
        var s = Math.Sqrt(Math.Abs(det));
        return s > 1e-12 ? s : 1.0;
    }

    private void DrawBoxOutline(DrawBox b, Color color)
    {
        if (b.IsEmpty) return;
        var p1 = Map(new DrawPoint(b.MinX, b.MinY));
        var p2 = Map(new DrawPoint(b.MaxX, b.MinY));
        var p3 = Map(new DrawPoint(b.MaxX, b.MaxY));
        var p4 = Map(new DrawPoint(b.MinX, b.MaxY));
        _display.DrawPolyline(new Polyline(new[] { p1, p2, p3, p4, p1 }), color, 1);
    }

    private void DrawDottedBox(DrawBox b, Color color)
    {
        if (b.IsEmpty) return;
        var p1 = Map(new DrawPoint(b.MinX, b.MinY));
        var p2 = Map(new DrawPoint(b.MaxX, b.MinY));
        var p3 = Map(new DrawPoint(b.MaxX, b.MaxY));
        var p4 = Map(new DrawPoint(b.MinX, b.MaxY));
        _display.DrawDottedLine(p1, p2, color);
        _display.DrawDottedLine(p2, p3, color);
        _display.DrawDottedLine(p3, p4, color);
        _display.DrawDottedLine(p4, p1, color);
    }

    private void DrawLinearDim(DimensionElement d)
    {
        var ax = d.A.X; var ay = d.A.Y;
        var bx = d.B.X; var by = d.B.Y;
        var dx = bx - ax; var dy = by - ay;
        var len = Math.Sqrt(dx * dx + dy * dy);
        if (len < 1e-9) return;

        var ux = dx / len; var uy = dy / len;
        var nx = -uy; var ny = ux;
        var offset = d.Offset;

        var dimA = new DrawPoint(ax + nx * offset, ay + ny * offset);
        var dimB = new DrawPoint(bx + nx * offset, by + ny * offset);

        _display.DrawLine(new Line(Map(d.A), Map(dimA)), DimColor);
        _display.DrawLine(new Line(Map(d.B), Map(dimB)), DimColor);
        _display.DrawLine(new Line(Map(dimA), Map(dimB)), DimColor);

        var label = string.IsNullOrEmpty(d.Label) ? len.ToString("0.##") : d.Label;
        var size = d.Style?.TextSize ?? 2.5;
        if (size > 0)
        {
            var midX = (dimA.X + dimB.X) * 0.5;
            var midY = (dimA.Y + dimB.Y) * 0.5;
            var mid = Map(new DrawPoint(midX, midY));
            var plane = new Plane(mid, Vector3d.XAxis, Vector3d.YAxis);
            _display.Draw3dText(label, DimColor, plane, size, "Arial");
        }
    }

    private void DrawAngularDim(DimensionElement d)
    {
        var vx = d.Vertex.X; var vy = d.Vertex.Y;
        var dax = d.A.X - vx; var day = d.A.Y - vy;
        var dbx = d.B.X - vx; var dby = d.B.Y - vy;
        var lenA = Math.Sqrt(dax * dax + day * day);
        var lenB = Math.Sqrt(dbx * dbx + dby * dby);
        if (lenA < 1e-9 || lenB < 1e-9) return;

        var radius = Math.Min(lenA, lenB) * 0.3;
        var uax = dax / lenA; var uay = day / lenA;
        var ubx = dbx / lenB; var uby = dby / lenB;

        var theta = Math.Atan2(uax * uby - uay * ubx, uax * ubx + uay * uby);
        if (Math.Abs(theta) < 1e-6) return;

        // Stub arms.
        _display.DrawLine(new Line(Map(d.Vertex), Map(d.A)), DimColor);
        _display.DrawLine(new Line(Map(d.Vertex), Map(d.B)), DimColor);

        // Sample the sweep arc.
        const int samples = 24;
        var startAng = Math.Atan2(uay, uax);
        var pts = new List<Point3d>(samples + 1);
        for (var i = 0; i <= samples; i++)
        {
            var u = i / (double)samples;
            var ang = startAng + theta * u;
            pts.Add(Map(new DrawPoint(vx + Math.Cos(ang) * radius, vy + Math.Sin(ang) * radius)));
        }
        _display.DrawPolyline(new Polyline(pts), DimColor, 1);

        var label = string.IsNullOrEmpty(d.Label)
            ? (Math.Abs(theta) * 180.0 / Math.PI).ToString("0.##") + "°"
            : d.Label;
        var size = d.Style?.TextSize ?? 2.5;
        if (size > 0)
        {
            var midAng = startAng + theta * 0.5;
            var mid = Map(new DrawPoint(vx + Math.Cos(midAng) * radius, vy + Math.Sin(midAng) * radius));
            var plane = new Plane(mid, Vector3d.XAxis, Vector3d.YAxis);
            _display.Draw3dText(label, DimColor, plane, size, "Arial");
        }
    }

    private static int StrokeThickness(double? width)
    {
        if (!width.HasValue || width.Value <= 0) return 1;
        // Stroke widths are in mm; viewport thickness is in pixels. A direct map is too thin
        // at typical zoom levels, so clamp to a readable 1..4 px range.
        var px = (int)Math.Round(width.Value * 2.0);
        if (px < 1) return 1;
        if (px > 4) return 4;
        return px;
    }

    private static Color ToSystemColor(DrawColor c, Color fallback)
    {
        switch (c.Space)
        {
            case DrawColorSpace.Rgb:
                return Color.FromArgb(
                    Round255(c.A), Round255(c.R), Round255(c.G), Round255(c.B));
            case DrawColorSpace.Cmyk:
                var r = (1 - c.C) * (1 - c.K);
                var g = (1 - c.M) * (1 - c.K);
                var b = (1 - c.Y) * (1 - c.K);
                return Color.FromArgb(Round255(c.A), Round255(r), Round255(g), Round255(b));
            default:
                return fallback;
        }
    }

    private static int Round255(double v)
    {
        var i = (int)Math.Round(v * 255.0);
        if (i < 0) return 0;
        if (i > 255) return 255;
        return i;
    }

    // A tessellated subpath: the points (in viewport space) plus whether the originating
    // path's MoveTo..[next MoveTo|end] range terminated in a Close segment. Closed subpaths
    // are eligible for fill / hatch operations.
    private readonly struct Subpath
    {
        public readonly List<Point3d> Points;
        public readonly bool Closed;
        public Subpath(List<Point3d> points, bool closed) { Points = points; Closed = closed; }
    }

    private List<Subpath> TessellateSubpaths(DrawPath path)
    {
        const int cubicSteps = 16;

        var result = new List<Subpath>();
        var current = new List<Point3d>();
        var closed = false;
        var cursor = default(DrawPoint);
        var subpathStart = default(DrawPoint);
        var cursorValid = false;

        void Flush()
        {
            if (current.Count > 0) result.Add(new Subpath(current, closed));
            current = new List<Point3d>();
            closed = false;
        }

        foreach (var seg in path)
        {
            switch (seg)
            {
                case PathSeg.MoveTo m:
                    Flush();
                    current.Add(Map(m.To));
                    cursor = m.To;
                    subpathStart = m.To;
                    cursorValid = true;
                    break;

                case PathSeg.LineTo l:
                    current.Add(Map(l.To));
                    cursor = l.To;
                    cursorValid = true;
                    break;

                case PathSeg.CubicTo c when cursorValid:
                    for (var i = 1; i <= cubicSteps; i++)
                    {
                        var t = i / (double)cubicSteps;
                        current.Add(Map(CubicAt(cursor, c.Control1, c.Control2, c.To, t)));
                    }
                    cursor = c.To;
                    break;

                case PathSeg.ArcTo a when cursorValid:
                    foreach (var p in SampleEllipticalArc(cursor, a))
                        current.Add(Map(p));
                    cursor = a.To;
                    break;

                case PathSeg.Close _ when cursorValid:
                    current.Add(Map(subpathStart));
                    cursor = subpathStart;
                    closed = true;
                    break;
            }
        }
        Flush();
        return result;
    }

    private static DrawPoint CubicAt(DrawPoint p0, DrawPoint p1, DrawPoint p2, DrawPoint p3, double t)
    {
        var u = 1 - t;
        var b0 = u * u * u;
        var b1 = 3 * u * u * t;
        var b2 = 3 * u * t * t;
        var b3 = t * t * t;
        return new DrawPoint(
            b0 * p0.X + b1 * p1.X + b2 * p2.X + b3 * p3.X,
            b0 * p0.Y + b1 * p1.Y + b2 * p2.Y + b3 * p3.Y);
    }

    // SVG endpoint-parameterization → center-parameterization (W3C SVG 1.1 Appendix F.6.5).
    // Yields points along the arc, excluding the start (cursor) and including the endpoint,
    // sampled at ~3° per step.
    private static IEnumerable<DrawPoint> SampleEllipticalArc(DrawPoint from, PathSeg.ArcTo a)
    {
        var rx = Math.Abs(a.RadiusX);
        var ry = Math.Abs(a.RadiusY);
        if (rx < 1e-9 || ry < 1e-9)
        {
            yield return a.To;
            yield break;
        }

        var phi = a.XAxisRotationDegrees * Math.PI / 180.0;
        var cosPhi = Math.Cos(phi);
        var sinPhi = Math.Sin(phi);

        // Step 1: compute (x1', y1') in the rotated frame.
        var dx = (from.X - a.To.X) * 0.5;
        var dy = (from.Y - a.To.Y) * 0.5;
        var x1p = cosPhi * dx + sinPhi * dy;
        var y1p = -sinPhi * dx + cosPhi * dy;

        // Step 2: scale radii up if endpoints are too far apart for the given radii.
        var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
        if (lambda > 1.0)
        {
            var s = Math.Sqrt(lambda);
            rx *= s;
            ry *= s;
        }

        // Step 3: compute (cx', cy').
        var rx2 = rx * rx;
        var ry2 = ry * ry;
        var x1p2 = x1p * x1p;
        var y1p2 = y1p * y1p;
        var num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
        var den = rx2 * y1p2 + ry2 * x1p2;
        var factor = den < 1e-12 ? 0.0 : Math.Sqrt(Math.Max(0.0, num / den));
        // Note: SVG's sweep-flag "1" is anti-clockwise in the canonical y-up frame used here
        // (Selva.Drawing operates in y-up, before any renderer-side flip). SweepClockwise
        // therefore inverts the sign relative to the W3C formula's large-arc/sweep rules.
        if (a.LargeArc == a.SweepClockwise) factor = -factor;
        var cxp = factor * (rx * y1p / ry);
        var cyp = factor * (-ry * x1p / rx);

        // Step 4: rotate back to the original frame.
        var cx = cosPhi * cxp - sinPhi * cyp + (from.X + a.To.X) * 0.5;
        var cy = sinPhi * cxp + cosPhi * cyp + (from.Y + a.To.Y) * 0.5;

        // Step 5: angles.
        var ux = (x1p - cxp) / rx;
        var uy = (y1p - cyp) / ry;
        var vx = (-x1p - cxp) / rx;
        var vy = (-y1p - cyp) / ry;
        var theta1 = AngleBetween(1, 0, ux, uy);
        var deltaTheta = AngleBetween(ux, uy, vx, vy);
        if (!a.SweepClockwise && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
        else if (a.SweepClockwise && deltaTheta < 0) deltaTheta += 2 * Math.PI;

        var arcLen = Math.Max(rx, ry) * Math.Abs(deltaTheta);
        var steps = Math.Max(8, (int)Math.Ceiling(arcLen / 0.5));
        if (steps > 256) steps = 256;

        for (var i = 1; i <= steps; i++)
        {
            var t = i / (double)steps;
            var ang = theta1 + deltaTheta * t;
            var ex = Math.Cos(ang) * rx;
            var ey = Math.Sin(ang) * ry;
            var px = cosPhi * ex - sinPhi * ey + cx;
            var py = sinPhi * ex + cosPhi * ey + cy;
            yield return new DrawPoint(px, py);
        }
    }

    private static double AngleBetween(double ux, double uy, double vx, double vy)
    {
        var dot = ux * vx + uy * vy;
        var len = Math.Sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        if (len < 1e-12) return 0;
        var c = dot / len;
        if (c < -1) c = -1;
        else if (c > 1) c = 1;
        var sign = (ux * vy - uy * vx) < 0 ? -1.0 : 1.0;
        return sign * Math.Acos(c);
    }

    // ============================================================================
    // Stroke / fill helpers
    // ============================================================================

    private void DrawDashedPolyline(IList<Point3d> pts, Color color)
    {
        // The DisplayPipeline only exposes DrawDottedLine for dashed-style drawing. Walking
        // the polyline segment by segment gives a consistent dash pattern without needing
        // the actual on/off lengths from the model — close enough for preview.
        for (var i = 0; i < pts.Count - 1; i++)
            _display.DrawDottedLine(pts[i], pts[i + 1], color);
    }

    private static Color ApplyOpacity(Color c, double opacity)
    {
        if (opacity >= 1.0) return c;
        if (opacity <= 0.0) return Color.FromArgb(0, c);
        var a = (int)Math.Round(c.A * opacity);
        if (a < 0) a = 0;
        else if (a > 255) a = 255;
        return Color.FromArgb(a, c.R, c.G, c.B);
    }

    // ============================================================================
    // Hatch pattern rendering
    // ============================================================================

    // Sweep parallel lines across the bounding box at the given angle/spacing, clip each
    // line to the boundary subpaths via even-odd ray crossings, and emit the inside spans.
    private void DrawHatchLines(List<Subpath> subpaths, DrawBox bounds, double angleDegrees, double spacing, Color color)
    {
        if (spacing <= 0) return;

        var theta = angleDegrees * Math.PI / 180.0;
        var dx = Math.Cos(theta);
        var dy = Math.Sin(theta);
        // Perpendicular axis along which we step from line to line.
        var nx = -dy;
        var ny = dx;

        var cx = (bounds.MinX + bounds.MaxX) * 0.5;
        var cy = (bounds.MinY + bounds.MaxY) * 0.5;
        // Half-diagonal of the bounding box along both axes.
        var halfSpan = Math.Sqrt(bounds.Width * bounds.Width + bounds.Height * bounds.Height) * 0.5 + spacing;

        var stepCount = (int)Math.Ceiling((halfSpan * 2) / spacing);
        if (stepCount > 2000) return; // guard against pathological inputs

        for (var i = -stepCount; i <= stepCount; i++)
        {
            var offset = i * spacing;
            // A point on this hatch line, with the line direction (dx, dy).
            var ox = cx + nx * offset;
            var oy = cy + ny * offset;

            // Parametric line: (ox + dx*t, oy + dy*t). Find boundary intersections in t.
            var crossings = new List<double>();
            CollectLineCrossings(subpaths, ox, oy, dx, dy, crossings);
            if (crossings.Count < 2) continue;
            crossings.Sort();

            // Even-odd: pair consecutive crossings; the segments between odd→even are inside.
            for (var k = 0; k + 1 < crossings.Count; k += 2)
            {
                var t0 = crossings[k];
                var t1 = crossings[k + 1];
                var p0 = new Point3d(ox + dx * t0, oy + dy * t0, 0);
                var p1 = new Point3d(ox + dx * t1, oy + dy * t1, 0);
                _display.DrawLine(new Line(p0, p1), color);
            }
        }
    }

    private static void CollectLineCrossings(List<Subpath> subpaths, double ox, double oy, double dx, double dy, List<double> output)
    {
        // For each polyline edge (p->q), find t along the hatch line where it crosses the
        // edge. The hatch line's "across" axis is perpendicular: (-dy, dx). The edge
        // crosses when its endpoints lie on opposite sides of the hatch line.
        foreach (var sp in subpaths)
        {
            if (!sp.Closed || sp.Points.Count < 2) continue;
            for (var i = 0; i < sp.Points.Count - 1; i++)
            {
                var p = sp.Points[i];
                var q = sp.Points[i + 1];
                var sp1 = (p.X - ox) * (-dy) + (p.Y - oy) * dx;
                var sp2 = (q.X - ox) * (-dy) + (q.Y - oy) * dx;
                if ((sp1 > 0 && sp2 > 0) || (sp1 < 0 && sp2 < 0)) continue;
                if (sp1 == sp2) continue; // colinear edge — skip to avoid div0
                var u = sp1 / (sp1 - sp2);
                var ix = p.X + (q.X - p.X) * u;
                var iy = p.Y + (q.Y - p.Y) * u;
                // Project intersection back onto hatch direction.
                var t = (ix - ox) * dx + (iy - oy) * dy;
                output.Add(t);
            }
        }
    }

    private void DrawHatchDots(List<Subpath> subpaths, DrawBox bounds, double spacing, Color color)
    {
        if (spacing <= 0) return;

        var minX = bounds.MinX;
        var minY = bounds.MinY;
        var cols = (int)Math.Ceiling(bounds.Width / spacing) + 1;
        var rows = (int)Math.Ceiling(bounds.Height / spacing) + 1;
        if ((long)cols * rows > 50_000) return; // guard

        for (var r = 0; r < rows; r++)
        {
            var y = minY + r * spacing;
            for (var c = 0; c < cols; c++)
            {
                var x = minX + c * spacing;
                if (!PointInSubpaths(subpaths, x, y)) continue;
                var pt = Map(new DrawPoint(x, y));
                _display.DrawPoint(pt, PointStyle.RoundSimple, 2, color);
            }
        }
    }

    private static bool PointInSubpaths(List<Subpath> subpaths, double x, double y)
    {
        // Even-odd ray cast (horizontal, +x) across all closed subpaths.
        var inside = false;
        foreach (var sp in subpaths)
        {
            if (!sp.Closed || sp.Points.Count < 2) continue;
            for (var i = 0; i < sp.Points.Count - 1; i++)
            {
                var p = sp.Points[i];
                var q = sp.Points[i + 1];
                if ((p.Y > y) == (q.Y > y)) continue;
                var dy = q.Y - p.Y;
                if (Math.Abs(dy) < 1e-12) continue;
                var xCross = p.X + (y - p.Y) * (q.X - p.X) / dy;
                if (xCross > x) inside = !inside;
            }
        }
        return inside;
    }
}
