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

// Walks a Selva.Drawing element tree and renders a quick layout preview into a Rhino
// viewport pipeline. Lives in Selva.GH (not Selva.Drawing) so the model layer stays
// free of RhinoCommon. This is a layout preview only — text shows real glyphs at the
// authored size, hatches show their outline, images show a placeholder rectangle.
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

        var color = element.Stroke != null
            ? ToSystemColor(element.Stroke.Color, StrokeFallback)
            : (element.Fill != null ? ToSystemColor(element.Fill.Color, FillOutlineFallback) : StrokeFallback);
        var thickness = StrokeThickness(element.Stroke?.Width);

        foreach (var poly in TessellatePath(element.Path))
        {
            if (poly.Count >= 2) _display.DrawPolyline(poly, color, thickness);
        }
    }

    public void Visit(TextElement element)
    {
        if (element == null) return;
        DrawBoxOutline(element.ComputeBounds(), BoxColor);

        var text = element.Text;
        if (string.IsNullOrEmpty(text)) return;

        var size = element.Style?.FontSize ?? 2.5;
        if (size <= 0) return;

        var pos = Map(element.Position);
        var plane = new Plane(pos, Vector3d.XAxis, Vector3d.YAxis);
        if (element.RotationDegrees != 0)
            plane.Rotate(element.RotationDegrees * Math.PI / 180.0, Vector3d.ZAxis, pos);
        _display.Draw3dText(text, TextColor, plane, size, "Arial");
    }

    public void Visit(TextBlockElement element)
    {
        if (element == null) return;
        DrawBoxOutline(element.Box, BoxColor);

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
        foreach (var poly in TessellatePath(element.Boundary))
        {
            if (poly.Count >= 2) _display.DrawPolyline(poly, HatchColor, 1);
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

    // Tessellate a Path into a sequence of polylines (one per subpath). MoveTo opens a new
    // subpath; Close re-emits the first vertex so the polyline visually closes. Cubic
    // segments are sampled at a fixed 16 steps — fine for layout preview; the renderer
    // does the precise math.
    private IEnumerable<List<Point3d>> TessellatePath(DrawPath path)
    {
        const int cubicSteps = 16;
        const int arcSteps = 24;

        var current = new List<Point3d>();
        var cursor = default(DrawPoint);
        var subpathStart = default(DrawPoint);
        var cursorValid = false;

        foreach (var seg in path)
        {
            switch (seg)
            {
                case PathSeg.MoveTo m:
                    if (current.Count > 0) yield return current;
                    current = new List<Point3d> { Map(m.To) };
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
                    // Layout-preview approximation: sample the arc's endpoint chord.
                    // Geometrically correct arc tessellation is the renderer's job.
                    for (var i = 1; i <= arcSteps; i++)
                    {
                        var t = i / (double)arcSteps;
                        current.Add(Map(new DrawPoint(
                            cursor.X + (a.To.X - cursor.X) * t,
                            cursor.Y + (a.To.Y - cursor.Y) * t)));
                    }
                    cursor = a.To;
                    break;

                case PathSeg.Close _ when cursorValid:
                    current.Add(Map(subpathStart));
                    cursor = subpathStart;
                    break;
            }
        }
        if (current.Count > 0) yield return current;
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
}
