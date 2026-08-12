using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Runtime.CompilerServices;
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
using FillRule = Selva.Drawing.Model.Style.FillRule;
using HatchPattern = Selva.Drawing.Model.Style.HatchPattern;
using Fill = Selva.Drawing.Model.Style.Fill;

namespace Selva.Drawing.RhinoInterop;

// Renders a Selva.Drawing element tree into a Rhino viewport, mirroring SvgRenderer's output.
// Lives in RhinoInterop (not Selva.Drawing) so the model layer stays free of RhinoCommon.
// Known gaps: images show a placeholder rectangle, and text metrics won't match a browser
// exactly since Rhino's display fonts differ from SVG glyphs.
public sealed class RhinoViewportVisitor : IElementVisitor
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
        // BoundsOverride comes from layout primitives (Grid, Frame, Table, TitleBlock) when the
        // resolved group's outer extent is wider than the union of its children. Only this
        // preview draws it — SVG/PDF output is unaffected.
        if (element.BoundsOverride.HasValue)
            DrawDottedBox(element.BoundsOverride.Value, LayoutBoundsColor);
        foreach (var child in element.Children) child?.Accept(this);
        _current = saved;
    }

    public void Visit(PathElement element)
    {
        if (element == null || element.Path.IsEmpty) return;

        var subpaths = TessellateSubpaths(element.Path);

        // Fill before stroke so strokes draw on top (SVG paint order). Fills prefer the
        // cached-Brep route (GPU-shaded, handles concave shapes + holes) and only fall back
        // to ear-clipping if Brep construction returns nothing. A hatch pattern replaces the
        // flat fill entirely.
        if (element.Fill != null)
        {
            var fillColor = ApplyOpacity(ToSystemColor(element.Fill.Color, FillOutlineFallback), element.Fill.Opacity);
            if (element.Fill.Pattern != HatchPattern.None)
                DrawFillPattern(element.Path, subpaths, element.Fill, fillColor);
            else if (!FillPathWithBreps(element.Path, fillColor))
                FillSubpaths(subpaths, fillColor, element.Fill.Rule);
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

        if (element.Background.HasValue)
            DrawTextBackground(element);

        var pos = Map(element.Position);
        var plane = new Plane(pos, Vector3d.XAxis, Vector3d.YAxis);
        if (element.RotationDegrees != 0)
            plane.Rotate(element.RotationDegrees * Math.PI / 180.0, Vector3d.ZAxis, pos);

        // Draw3dText(string, color, plane, size, font) centers the run on the plane origin,
        // ignoring anchors — build a Text3d instead so HorizontalAlignment/VerticalAlignment
        // are respected and the run sits on the actual Position.
        var fontFace = ResolveFontFace(style?.FontFamily);
        // transformScale undoes DrawingView's 1/effectiveScale pre-multiply on FontSize (that
        // pre-multiply exists so the SVG/PDF group transform cancels it back to paper-space mm).
        // Text3d ignores the parent transform, so apply the scale here instead.
        var capRatio = CapHeightToEmRatio(style);
        var transformScale = UniformScale(_current);
        var t3d = new Rhino.Display.Text3d(text, plane, size * capRatio * transformScale) { FontFace = fontFace };
        t3d.HorizontalAlignment = ToRhinoHAlign(style?.HorizontalAnchor ?? Selva.Drawing.Model.Style.TextAnchor.Left);
        t3d.VerticalAlignment = ToRhinoVAlign(style?.VerticalAnchor ?? Selva.Drawing.Model.Style.VerticalAnchor.Baseline);
        var textColor = style != null ? ToSystemColor(style.Color, TextColor) : TextColor;
        _display.Draw3dText(t3d, textColor);
        t3d.Dispose();
    }

    // Rhino's Text3d sizes by cap-height, SVG/PDF size by em — without this ratio, preview
    // glyphs come out ~1.4x too big. Uses bundled font metrics when available, else 0.7.
    private static double CapHeightToEmRatio(Selva.Drawing.Model.Style.TextStyle? style)
    {
        const double fallback = 0.7;
        if (style == null || style.FontSize <= 0) return fallback;
        var measured = Selva.Drawing.Fonts.FontMetrics.Measure("H", style);
        if (measured.CapHeight <= 0) return fallback;
        return measured.CapHeight / style.FontSize;
    }

    // First family in a CSS-style stack ("Inter, Helvetica, sans-serif" -> "Inter"). Matches
    // FontMetrics.ExtractFirstFamily so the preview's glyph metrics line up with the
    // background rect drawn from those same metrics.
    private static string ResolveFontFace(string? fontFamily)
    {
        if (fontFamily == null || fontFamily.Length == 0) return "Inter";
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
            default: return Rhino.DocObjects.TextVerticalAlignment.Bottom; // Baseline -> Rhino's Bottom
        }
    }

    // Mirrors SvgRenderer.AppendTextBackgroundRect. DisplayPipeline has no rounded-rect
    // helper, so corner radius is ignored here — final SVG/PDF output still honors it.
    private void DrawTextBackground(TextElement element)
    {
        if (element.Background is not { } background) return;
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

        var bgColor = ToSystemColor(background, Color.Transparent);
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
            FillSubpaths(subpaths, bg, FillRule.EvenOdd);
        }

        // Always trace the boundary so the region is legible even when the pattern is sparse.
        foreach (var sp in subpaths)
            if (sp.Points.Count >= 2)
                _display.DrawPolyline(sp.Points, lineColor, 1);

        if (element.Pattern == HatchPatternKind.Solid)
        {
            FillSubpaths(subpaths, lineColor, FillRule.EvenOdd);
            return;
        }

        var spacing = element.Spacing > 0 ? element.Spacing : 2.0;

        switch (element.Pattern)
        {
            case HatchPatternKind.Lines:
                DrawHatchLines(subpaths, element.AngleDegrees, spacing, lineColor);
                break;
            case HatchPatternKind.CrossHatch:
                DrawHatchLines(subpaths, element.AngleDegrees, spacing, lineColor);
                DrawHatchLines(subpaths, element.AngleDegrees + 90, spacing, lineColor);
                break;
            case HatchPatternKind.Dots:
                DrawHatchDots(subpaths, spacing, lineColor);
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

    // A direction vector pushed through the current transform's linear part (no
    // translation) and normalized — used so hatch patterns rotate with their group
    // transform the way the exporters' patterns do.
    private (double X, double Y) MapDirection(double x, double y)
    {
        var mx = _current.A * x + _current.C * y;
        var my = _current.B * x + _current.D * y;
        var len = Math.Sqrt(mx * mx + my * my);
        if (len < 1e-12) return (x, y);
        return (mx / len, my / len);
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

        var dimColor = d.Style != null ? ToSystemColor(d.Style.Color, DimColor) : DimColor;
        _display.DrawLine(new Line(Map(d.A), Map(dimA)), dimColor);
        _display.DrawLine(new Line(Map(d.B), Map(dimB)), dimColor);
        _display.DrawLine(new Line(Map(dimA), Map(dimB)), dimColor);

        var label = string.IsNullOrEmpty(d.Label) ? len.ToString("0.##", CultureInfo.InvariantCulture) : d.Label;
        var size = d.Style?.TextSize ?? 2.5;
        if (size > 0)
        {
            // Mirror the exporters: label centred on the dimension line, rotated along its
            // direction, lifted off the line unless the placement breaks the line.
            var style = d.Style ?? new DimensionStyle();
            var lift = style.TextPlacement == DimensionTextPlacement.BreakLine
                ? 0.0
                : size * style.TextLiftFactor;
            var sign = offset >= 0 ? 1 : -1;
            var midX = (dimA.X + dimB.X) * 0.5 + nx * lift * sign;
            var midY = (dimA.Y + dimB.Y) * 0.5 + ny * lift * sign;
            DrawDimLabel(label, new DrawPoint(midX, midY), new DrawPoint(ux, uy), style, size, dimColor);
        }
    }

    // Centred, rotated dimension label matching the exporters' placement. Direction is in
    // model space; mapped axes keep the rotation correct under page-tile / view-scale
    // transforms, and the cap-height correction matches DrawText's em sizing.
    private void DrawDimLabel(string label, DrawPoint anchor, DrawPoint direction, DimensionStyle style, double size, Color color)
    {
        var mid = Map(anchor);
        var alongEnd = Map(new DrawPoint(anchor.X + direction.X, anchor.Y + direction.Y));
        var xAxis = alongEnd - mid;
        if (xAxis.X < 0) xAxis.Reverse(); // keep labels readable left-to-right
        if (!xAxis.Unitize()) xAxis = Vector3d.XAxis;
        var yAxis = Vector3d.CrossProduct(Vector3d.ZAxis, xAxis);
        var plane = new Plane(mid, xAxis, yAxis);
        var textStyle = new Selva.Drawing.Model.Style.TextStyle { FontFamily = style.FontFamily, FontSize = size };
        var t3d = new Rhino.Display.Text3d(label, plane, size * CapHeightToEmRatio(textStyle) * UniformScale(_current))
        {
            FontFace = ResolveFontFace(style.FontFamily),
            HorizontalAlignment = Rhino.DocObjects.TextHorizontalAlignment.Center,
            VerticalAlignment = Rhino.DocObjects.TextVerticalAlignment.Middle,
        };
        _display.Draw3dText(t3d, color);
        t3d.Dispose();
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

        var dimColor = d.Style != null ? ToSystemColor(d.Style.Color, DimColor) : DimColor;

        // Stub arms.
        _display.DrawLine(new Line(Map(d.Vertex), Map(d.A)), dimColor);
        _display.DrawLine(new Line(Map(d.Vertex), Map(d.B)), dimColor);

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
        _display.DrawPolyline(new Polyline(pts), dimColor, 1);

        var label = string.IsNullOrEmpty(d.Label)
            ? (Math.Abs(theta) * 180.0 / Math.PI).ToString("0.##", CultureInfo.InvariantCulture) + "°"
            : d.Label;
        var size = d.Style?.TextSize ?? 2.5;
        if (size > 0)
        {
            // Label sits past the arc on the angle bisector, rotated along the arc tangent —
            // matches the exporters' lifted placement.
            var style = d.Style ?? new DimensionStyle();
            var midAng = startAng + theta * 0.5;
            var textRadius = radius + size * style.TextLiftFactor;
            var anchor = new DrawPoint(vx + Math.Cos(midAng) * textRadius, vy + Math.Sin(midAng) * textRadius);
            var tangent = new DrawPoint(-Math.Sin(midAng), Math.Cos(midAng));
            DrawDimLabel(label, anchor, tangent, style, size, dimColor);
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
            // Subpaths that return to their start point fill in SVG/PDF even without an
            // explicit Close — treat them as closed so the preview matches the export.
            var geometricallyClosed = closed || (cursorValid && current.Count > 2
                && Math.Abs(cursor.X - subpathStart.X) < 1e-9
                && Math.Abs(cursor.Y - subpathStart.Y) < 1e-9);
            if (current.Count > 0) result.Add(new Subpath(current, geometricallyClosed));
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
    // Brep-based fill (preferred path — concave + holes via Rhino's planar Brep)
    // ============================================================================

    // Model Path -> planar Breps, built once per unique Path instance and reused across
    // redraws. ConditionalWeakTable lets entries GC once the Path is no longer referenced.
    // Empty array = "tried, got nothing" (fall back to mesh path); null is never stored.
    private static readonly ConditionalWeakTable<DrawPath, Brep[]> _brepCache =
        new ConditionalWeakTable<DrawPath, Brep[]>();

    // DisplayMaterial wraps unmanaged resources; building one per filled path per redraw
    // leaked at viewport refresh rate. Cached per ARGB value for process lifetime instead.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<int, DisplayMaterial> _materialCache =
        new System.Collections.Concurrent.ConcurrentDictionary<int, DisplayMaterial>();

    private static DisplayMaterial MaterialFor(Color color) =>
        _materialCache.GetOrAdd(color.ToArgb(), _ =>
        {
            var material = new DisplayMaterial(color);
            if (color.A < 255) material.Transparency = 1.0 - color.A / 255.0;
            return material;
        });

    // Returns true if the fill was rendered via DrawBrepShaded (the fast path). Returns
    // false if we couldn't build any Breps from this path (no closed subpaths, or
    // CreatePlanarBreps rejected the input) — caller falls back to the mesh path.
    private bool FillPathWithBreps(DrawPath path, Color color)
    {
        // GetValue's factory runs under the table's lock — unlike TryGetValue-then-Add,
        // it can't throw when two display pipelines race on the same path.
        var breps = _brepCache.GetValue(path, BuildBrepsForPath);
        if (breps.Length == 0) return false;

        // Push the model-space transform onto the display stack so Rhino applies it on the
        // GPU; the cached Brep stays in path-local coordinates and is reused as-is.
        var t = ToRhinoTransform(_current);
        var pushed = !t.IsIdentity;
        if (pushed) _display.PushModelTransform(t);

        var material = MaterialFor(color);
        foreach (var b in breps) _display.DrawBrepShaded(b, material);

        if (pushed) _display.PopModelTransform();
        return true;
    }

    private static Brep[] BuildBrepsForPath(DrawPath path)
    {
        var curves = PathToCurves.ClosedSubpaths(path);
        if (curves.Count == 0) return Array.Empty<Brep>();
        // CreatePlanarBreps groups outer + hole curves by containment, returning one Brep
        // per outer with its holes trimmed. Tolerance 0.001 mm is generous for paper-space
        // drawings; tighter tolerances cause valid breps to be rejected when curves come
        // from float-precision tessellation.
        var built = Brep.CreatePlanarBreps(curves, 0.001);
        return built ?? Array.Empty<Brep>();
    }

    private static Rhino.Geometry.Transform ToRhinoTransform(DrawTransform t)
    {
        var m = Rhino.Geometry.Transform.Identity;
        // SVG matrix(A B C D E F): x' = A*x + C*y + E, y' = B*x + D*y + F. Z stays 0.
        m.M00 = t.A; m.M01 = t.C; m.M03 = t.E;
        m.M10 = t.B; m.M11 = t.D; m.M13 = t.F;
        return m;
    }

    // ============================================================================
    // Polygon fill (fallback for hatches and Brep-rejected paths)
    // ============================================================================

    // DisplayPipeline.DrawPolygon does fan-triangulation from vertex 0, which produces
    // visible artifacts on concave outlines and ignores holes entirely. Fix: triangulate
    // the closed subpaths (respecting the fill rule for hole detection) and shade the
    // resulting mesh. This matches what the SVG/PDF renderers actually output.
    private void FillSubpaths(List<Subpath> subpaths, Color color, FillRule rule)
    {
        var rings = new List<List<Point3d>>();
        foreach (var sp in subpaths)
            if (sp.Closed && sp.Points.Count >= 4) // last point repeats start, so >=4 = >=3 unique
                rings.Add(sp.Points);
        if (rings.Count == 0) return;

        var mesh = TriangulateRings(rings, rule);
        if (mesh == null || mesh.Faces.Count == 0) return;

        _display.DrawMeshShaded(mesh, MaterialFor(color));
    }

    // Build a triangle mesh from a set of closed rings. Outer rings get filled, hole
    // rings are subtracted via "bridges": a seam from the hole to the outer ring that
    // turns "polygon-with-holes" into a single weakly-simple polygon ear-clipping handles.
    //
    // Hole detection follows the requested fill rule. EvenOdd: a ring is a hole when it
    // sits inside an odd number of other rings. NonZero: classify by signed area; for
    // our purposes (paths from CurveConverter) the practical effect is the same since
    // we don't get authoritative winding info from the source curves.
    private static Mesh? TriangulateRings(List<List<Point3d>> rings, FillRule rule)
    {
        _ = rule; // Both rules use the same depth-parity hole classification for now; kept
                  // as a parameter so a future refinement can branch without new call sites.
        var n = rings.Count;
        if (n == 1) return TriangulatePolygon(rings[0], null);

        // Drop the trailing duplicate point used for stroke rendering — ear-clipping
        // wants the bare ring with no closing repeat.
        var bare = new List<List<Point3d>>(n);
        foreach (var r in rings) bare.Add(StripClosingDuplicate(r));

        // Classify each ring as outer or hole by counting how many other rings contain
        // its representative point. Even count → outer, odd → hole. This matches SVG's
        // even-odd rule and is a reasonable approximation for non-zero given our inputs.
        var depth = new int[n];
        for (var i = 0; i < n; i++)
        {
            var rep = bare[i][0];
            for (var j = 0; j < n; j++)
            {
                if (i == j) continue;
                if (RingContains(bare[j], rep.X, rep.Y)) depth[i]++;
            }
        }

        // Group holes with their immediate parent (smallest-area enclosing outer).
        var children = new List<List<int>>(n);
        for (var i = 0; i < n; i++) children.Add(new List<int>());
        for (var i = 0; i < n; i++)
        {
            if (depth[i] % 2 == 0) continue; // outer
            var parent = -1;
            var bestArea = double.MaxValue;
            for (var j = 0; j < n; j++)
            {
                if (i == j || depth[j] % 2 != 0) continue;
                if (depth[j] != depth[i] - 1) continue;
                if (!RingContains(bare[j], bare[i][0].X, bare[i][0].Y)) continue;
                var a = Math.Abs(SignedArea(bare[j]));
                if (a < bestArea) { bestArea = a; parent = j; }
            }
            if (parent >= 0) children[parent].Add(i);
        }

        var combined = new Mesh();
        for (var i = 0; i < n; i++)
        {
            if (depth[i] % 2 != 0) continue;
            var holes = children[i].Count > 0 ? children[i].ConvertAll(h => bare[h]) : null;
            var sub = TriangulatePolygon(bare[i], holes);
            if (sub != null && sub.Faces.Count > 0) combined.Append(sub);
        }
        return combined;
    }

    private static List<Point3d> StripClosingDuplicate(List<Point3d> ring)
    {
        if (ring.Count < 2) return ring;
        var first = ring[0];
        var last = ring[ring.Count - 1];
        if (first.DistanceToSquared(last) < 1e-18)
        {
            var trimmed = new List<Point3d>(ring.Count - 1);
            for (var i = 0; i < ring.Count - 1; i++) trimmed.Add(ring[i]);
            return trimmed;
        }
        return ring;
    }

    private static double SignedArea(List<Point3d> ring)
    {
        var a = 0.0;
        for (var i = 0; i < ring.Count; i++)
        {
            var p = ring[i];
            var q = ring[(i + 1) % ring.Count];
            a += p.X * q.Y - q.X * p.Y;
        }
        return a * 0.5;
    }

    private static bool RingContains(List<Point3d> ring, double x, double y)
    {
        var inside = false;
        var n = ring.Count;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            var pi = ring[i];
            var pj = ring[j];
            if ((pi.Y > y) == (pj.Y > y)) continue;
            var dy = pj.Y - pi.Y;
            if (Math.Abs(dy) < 1e-12) continue;
            var xCross = pi.X + (y - pi.Y) * (pj.X - pi.X) / dy;
            if (xCross > x) inside = !inside;
        }
        return inside;
    }

    // Ear-clipping triangulation. If `holes` is given, each hole is bridged to the outer
    // ring by inserting a back-and-forth seam, producing a single weakly-simple polygon.
    // Returns a Mesh with the resulting triangles, or null if the input is degenerate.
    private static Mesh? TriangulatePolygon(List<Point3d> outer, List<List<Point3d>>? holes)
    {
        var ring = StripClosingDuplicate(outer);
        if (ring.Count < 3) return null;

        // Ensure outer is CCW so the ear-clip "left-turn" test classifies reflex vertices
        // correctly. Holes get the opposite (CW) orientation.
        var working = new List<Point3d>(ring);
        if (SignedArea(working) < 0) working.Reverse();

        if (holes != null && holes.Count > 0)
            working = BridgeHoles(working, holes);

        if (working.Count < 3) return null;

        var mesh = new Mesh();
        foreach (var p in working) mesh.Vertices.Add(p.X, p.Y, 0);

        // Ear-clipping with a small reflex cache for O(n²) total work.
        var indices = new List<int>(working.Count);
        for (var i = 0; i < working.Count; i++) indices.Add(i);

        var guard = working.Count * working.Count + 16;
        while (indices.Count > 3 && guard-- > 0)
        {
            var clipped = false;
            for (var i = 0; i < indices.Count; i++)
            {
                var i0 = indices[(i - 1 + indices.Count) % indices.Count];
                var i1 = indices[i];
                var i2 = indices[(i + 1) % indices.Count];
                if (!IsEar(working, indices, i0, i1, i2)) continue;
                mesh.Faces.AddFace(i0, i1, i2);
                indices.RemoveAt(i);
                clipped = true;
                break;
            }
            if (!clipped) break; // no ear found — input is malformed; bail to avoid infinite loop
        }
        if (indices.Count == 3)
            mesh.Faces.AddFace(indices[0], indices[1], indices[2]);

        return mesh;
    }

    private static bool IsEar(List<Point3d> verts, List<int> indices, int i0, int i1, int i2)
    {
        var a = verts[i0]; var b = verts[i1]; var c = verts[i2];
        var cross = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
        if (cross <= 1e-12) return false; // reflex or colinear in CCW polygon

        // No other polygon vertex inside this triangle.
        foreach (var idx in indices)
        {
            if (idx == i0 || idx == i1 || idx == i2) continue;
            if (PointInTriangle(verts[idx], a, b, c)) return false;
        }
        return true;
    }

    private static bool PointInTriangle(Point3d p, Point3d a, Point3d b, Point3d c)
    {
        var d1 = Sign(p, a, b);
        var d2 = Sign(p, b, c);
        var d3 = Sign(p, c, a);
        var hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        var hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    }

    private static double Sign(Point3d p, Point3d a, Point3d b) =>
        (p.X - b.X) * (a.Y - b.Y) - (a.X - b.X) * (p.Y - b.Y);

    // Combine outer + holes into a single ring by inserting bridges. For each hole,
    // pick the hole vertex with maximum X, find a visible vertex on the outer ring,
    // and splice the hole vertices into the outer ring with a back-and-forth seam.
    // Holes must be wound CW relative to outer's CCW; the splice flips them as needed.
    private static List<Point3d> BridgeHoles(List<Point3d> outerCcw, List<List<Point3d>> holes)
    {
        var combined = new List<Point3d>(outerCcw);

        // Process holes in descending order of rightmost X — bridging the right-most
        // hole first reduces the chance that a later bridge crosses an earlier one.
        var ordered = new List<List<Point3d>>(holes);
        ordered.Sort((h1, h2) => MaxX(h2).CompareTo(MaxX(h1)));

        foreach (var hole in ordered)
        {
            var bare = StripClosingDuplicate(hole);
            if (bare.Count < 3) continue;

            // Force CW so the splice produces a consistent CCW combined ring.
            var holeRing = new List<Point3d>(bare);
            if (SignedArea(holeRing) > 0) holeRing.Reverse();

            // Find hole's rightmost vertex.
            var holeIdx = 0;
            for (var i = 1; i < holeRing.Count; i++)
                if (holeRing[i].X > holeRing[holeIdx].X) holeIdx = i;

            // Find a "visible" outer vertex: pick the outer vertex with smallest distance
            // to the hole vertex such that the connecting segment doesn't cross any other
            // outer edge. (This is the simplified Eberly bridge: not optimal in pathological
            // cases, but robust enough for the well-behaved paths Rhino produces.)
            var outerIdx = FindVisibleOuterVertex(combined, holeRing[holeIdx]);
            if (outerIdx < 0) continue;

            // Splice: outer[0..outerIdx], outer[outerIdx], hole[holeIdx..end..holeIdx],
            // outer[outerIdx], outer[outerIdx+1..end].
            var spliced = new List<Point3d>(combined.Count + holeRing.Count + 2);
            for (var i = 0; i <= outerIdx; i++) spliced.Add(combined[i]);
            for (var k = 0; k < holeRing.Count; k++)
                spliced.Add(holeRing[(holeIdx + k) % holeRing.Count]);
            spliced.Add(holeRing[holeIdx]);
            spliced.Add(combined[outerIdx]);
            for (var i = outerIdx + 1; i < combined.Count; i++) spliced.Add(combined[i]);
            combined = spliced;
        }
        return combined;
    }

    private static double MaxX(List<Point3d> pts)
    {
        var m = double.NegativeInfinity;
        foreach (var p in pts) if (p.X > m) m = p.X;
        return m;
    }

    private static int FindVisibleOuterVertex(List<Point3d> outer, Point3d holePt)
    {
        var best = -1;
        var bestDist = double.MaxValue;
        for (var i = 0; i < outer.Count; i++)
        {
            var v = outer[i];
            var dx = v.X - holePt.X; var dy = v.Y - holePt.Y;
            var d = dx * dx + dy * dy;
            if (d >= bestDist) continue;
            if (SegmentClearOfRing(holePt, v, outer, i)) { best = i; bestDist = d; }
        }
        return best;
    }

    private static bool SegmentClearOfRing(Point3d p, Point3d q, List<Point3d> ring, int skipIdx)
    {
        var n = ring.Count;
        for (var i = 0; i < n; i++)
        {
            // Skip edges incident to the candidate vertex — they share an endpoint with q.
            if (i == skipIdx || (i + 1) % n == skipIdx) continue;
            var a = ring[i];
            var b = ring[(i + 1) % n];
            if (SegmentsIntersect(p, q, a, b)) return false;
        }
        return true;
    }

    private static bool SegmentsIntersect(Point3d p1, Point3d p2, Point3d p3, Point3d p4)
    {
        var d1 = Sign(p1, p3, p4);
        var d2 = Sign(p2, p3, p4);
        var d3 = Sign(p3, p1, p2);
        var d4 = Sign(p4, p1, p2);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
        return false;
    }

    // ============================================================================
    // Hatch pattern rendering
    // ============================================================================

    // Renders Fill.Pattern on a PathElement to mirror SVG/PDF output (which use
    // tile = 4mm * scale, lines at 45° + PatternAngle). Hatch replaces the flat fill.
    private void DrawFillPattern(DrawPath path, List<Subpath> subpaths, Fill fill, Color color)
    {
        var scale = fill.PatternScale > 0 ? fill.PatternScale : 1.0;
        var spacing = 4.0 * scale;
        var angle = fill.PatternAngle;

        switch (fill.Pattern)
        {
            case HatchPattern.Lines:
                DrawHatchLines(subpaths, 45.0 + angle, spacing, color);
                break;
            case HatchPattern.CrossHatch:
                DrawHatchLines(subpaths, 45.0 + angle, spacing, color);
                DrawHatchLines(subpaths, -45.0 + angle, spacing, color);
                break;
            case HatchPattern.Dots:
                DrawHatchDots(subpaths, spacing, color);
                break;
            case HatchPattern.Brick:
                // Approximate brick coursing: horizontal lines + perpendicular ticks.
                DrawHatchLines(subpaths, angle, spacing, color);
                DrawHatchLines(subpaths, 90.0 + angle, spacing * 2, color);
                break;
        }
    }

    // Bounding box of the already-mapped subpath points. Hatch generation, clipping, and
    // emission must all live in this one (mapped) space — mixing it with the unmapped model
    // bbox shifted or dropped hatches on every page tile / scaled view after the first.
    private static DrawBox MappedBounds(List<Subpath> subpaths)
    {
        double minX = double.PositiveInfinity, minY = double.PositiveInfinity;
        double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
        foreach (var sp in subpaths)
        {
            foreach (var p in sp.Points)
            {
                if (p.X < minX) minX = p.X;
                if (p.X > maxX) maxX = p.X;
                if (p.Y < minY) minY = p.Y;
                if (p.Y > maxY) maxY = p.Y;
            }
        }
        return minX > maxX ? DrawBox.Empty : new DrawBox(minX, minY, maxX, maxY);
    }

    // Sweep parallel lines across the mapped bounds at the given angle/spacing, clip each
    // line to the boundary subpaths via even-odd ray crossings, and emit the inside spans.
    // The pattern direction rotates and the spacing scales with the current transform so
    // the preview matches the exporters, where the group transform carries the pattern.
    private void DrawHatchLines(List<Subpath> subpaths, double angleDegrees, double spacing, Color color)
    {
        spacing *= UniformScale(_current);
        if (spacing <= 0) return;
        var bounds = MappedBounds(subpaths);
        if (bounds.IsEmpty) return;

        var theta = angleDegrees * Math.PI / 180.0;
        var (dx, dy) = MapDirection(Math.Cos(theta), Math.Sin(theta));
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

    private void DrawHatchDots(List<Subpath> subpaths, double spacing, Color color)
    {
        // Grid, inside-test, and emission all in mapped space — the subpath points were
        // already mapped, so testing unmapped grid points against them dropped every dot
        // under a non-identity transform.
        spacing *= UniformScale(_current);
        if (spacing <= 0) return;
        var bounds = MappedBounds(subpaths);
        if (bounds.IsEmpty) return;

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
                _display.DrawPoint(new Point3d(x, y, 0), PointStyle.RoundSimple, 2, color);
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
