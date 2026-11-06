// Grasshopper Script Instance
using System;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;

using Rhino;
using Rhino.Geometry;

using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;

public class Script_Instance : GH_ScriptInstance
{
    // The spec sheet's two views, flat on XY in model millimetres: an elevation looking along +Y with Z
    // up, and a plan. Each comes with its dimensions, the scale it needs and its longest side.
    private void RunScript(List<object> Body, List<object> Light, List<object> Cable,
		object Base, object BaseSize, object DeskThickness, object Height, object Reach, object Head, object HeadSize, object BarLength,
		ref object ElevLines, ref object ElevHidden, ref object ElevDesk, ref object ElevDimA, ref object ElevDimB, ref object ElevDimLabel,
		ref object ElevScaleNeed, ref object ElevSize,
		ref object PlanLines, ref object PlanHidden, ref object PlanDimA, ref object PlanDimB, ref object PlanDimLabel,
		ref object PlanScaleNeed, ref object PlanSize)
    {
        string baseType = Txt(Base, "Round"), head = Txt(Head, "Dome");
        double size = Num(BaseSize, 180), deskT = Num(DeskThickness, 30), h = Num(Height, 480), reach = Num(Reach, 360);
        bool clamp = baseType == "Clamp", bar = head == "Linear Bar";
        double footprint = clamp ? 0 : size / 2;
        List<Mesh> body = Meshes(Body), light = Meshes(Light), cable = Meshes(Cable);

        // The elevation stops 50 mm behind the base, so the cable's run across the desk doesn't halve the
        // scale. Break lines mark where the desk is cut.
        double cutX = -footprint - 50, cutY = -deskT - (clamp ? 90 : 1);
        var elevLines = Clip(Outlines(body.Concat(cable), true), cutX, cutY);
        var elevHidden = Clip(Outlines(light, true), cutX, cutY);
        var lampBox = Box(elevLines);
        double deskTo = lampBox.Max.X + 30, deskFrom = clamp ? 0 : cutX;
        var desk = new List<Point3d> { new Point3d(deskTo, 0, 0), new Point3d(deskFrom, 0, 0) };
        if (clamp) desk.Add(new Point3d(0, -deskT, 0)); else desk.AddRange(Break(new Point3d(deskFrom, 0, 0), deskT, -1));
        var rightEnd = Break(new Point3d(deskTo, 0, 0), deskT, 1);
        rightEnd.Reverse();
        desk.AddRange(rightEnd);
        desk.Add(new Point3d(deskTo, 0, 0));
        double top = lampBox.Max.Y;

        var planLines = Outlines(body, false);
        var planBox = Box(planLines);
        var planA = new List<Point3d>(); var planB = new List<Point3d>(); var planLabel = new List<string>();
        if (!clamp)
        {
            planA.Add(new Point3d(-footprint, planBox.Min.Y, 0)); planB.Add(new Point3d(footprint, planBox.Min.Y, 0));
            planLabel.Add(string.Format(Inv, baseType == "Round" ? "Ø{0:0}" : "{0:0}", size));
        }
        double headHalf = bar ? Num(BarLength, 420) / 2 : Num(HeadSize, 170) / 2;
        planA.Add(new Point3d(planBox.Max.X, -headHalf, 0)); planB.Add(new Point3d(planBox.Max.X, headHalf, 0));
        planLabel.Add(string.Format(Inv, bar ? "{0:0}" : "Ø{0:0}", headHalf * 2));

        // An A3 sheet holds the elevation in about 175 x 170 mm and the plan in 155 x 85 mm.
        var elevBox = lampBox;
        foreach (var p in desk) elevBox.Union(p);
        elevBox.Union(new Point3d(cutX, h, 0));
        var planAll = planBox;
        foreach (var p in planA.Concat(planB)) planAll.Union(p);

        ElevLines = elevLines; ElevHidden = elevHidden; ElevDesk = new PolylineCurve(desk);
        ElevDimA = new List<Point3d> { new Point3d(cutX, 0, 0), new Point3d(0, top, 0) };
        ElevDimB = new List<Point3d> { new Point3d(cutX, h, 0), new Point3d(reach, top, 0) };
        ElevDimLabel = new List<string> { string.Format(Inv, "{0:0}", h), string.Format(Inv, "{0:0}", reach) };
        ElevScaleNeed = Math.Max(elevBox.Diagonal.X / 175, elevBox.Diagonal.Y / 170);
        ElevSize = Math.Max(elevBox.Diagonal.X, elevBox.Diagonal.Y);
        PlanLines = planLines; PlanHidden = Outlines(light, false);
        PlanDimA = planA; PlanDimB = planB; PlanDimLabel = planLabel;
        PlanScaleNeed = Math.Max(planAll.Diagonal.X / 155, planAll.Diagonal.Y / 85);
        PlanSize = Math.Max(planAll.Diagonal.X, planAll.Diagonal.Y);
    }

    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    static List<Mesh> Meshes(List<object> items)
    {
        return items.Select(o => o as Mesh ?? (o as GH_Mesh)?.Value).Where(m => m != null).ToList();
    }

    // Each part's silhouette, open edges and creases over 30°, flat on XY: an elevation maps (x, z) to
    // (x, y). Mesh.GetOutlines gives one clean union but took seconds on some heads, and
    // Silhouette.Compute missed whole parts; walking the mesh edges is linear and never misses.
    static List<Curve> Outlines(IEnumerable<Mesh> meshes, bool elevation)
    {
        var view = elevation ? Vector3d.YAxis : -Vector3d.ZAxis;
        Func<Point3d, Point3d> flat = p => elevation ? new Point3d(p.X, p.Z, 0) : new Point3d(p.X, p.Y, 0);
        var segments = new List<Curve>();
        foreach (var m in meshes)
        {
            m.FaceNormals.ComputeFaceNormals();
            var edges = m.TopologyEdges;
            for (int e = 0; e < edges.Count; e++)
            {
                var faces = edges.GetConnectedFaces(e);
                bool draw = faces.Length == 1;
                if (faces.Length == 2)
                {
                    Vector3d a = m.FaceNormals[faces[0]], b = m.FaceNormals[faces[1]];
                    draw = (a * view) * (b * view) < 0 || Vector3d.VectorAngle(a, b) > Math.PI / 6;
                }
                if (!draw) continue;
                var line = edges.EdgeLine(e);
                var from = flat(line.From); var to = flat(line.To);
                if (from.DistanceTo(to) > 0.01) segments.Add(new LineCurve(from, to));
            }
        }
        var joined = new List<Curve>();
        foreach (var c in Curve.JoinCurves(segments, 0.01))
        {
            Polyline pl;
            if (c.TryGetPolyline(out pl)) joined.Add(new PolylineCurve(pl));
        }
        return joined;
    }

    // The runs of each polyline with x >= x0 and y >= y0.
    static List<Curve> Clip(IEnumerable<Curve> curves, double x0, double y0)
    {
        Func<Point3d, bool> inside = p => p.X >= x0 && p.Y >= y0;
        var kept = new List<Curve>();
        foreach (var c in curves)
        {
            Polyline pl;
            if (!c.TryGetPolyline(out pl)) continue;
            var run = new List<Point3d>();
            for (int i = 0; i < pl.Count; i++)
            {
                if (i > 0 && inside(pl[i]) != inside(pl[i - 1])) run.Add(Crossing(pl[i - 1], pl[i], x0, y0));
                if (inside(pl[i])) { run.Add(pl[i]); continue; }
                if (run.Count > 1) kept.Add(new PolylineCurve(run));
                run = new List<Point3d>();
            }
            if (run.Count > 1) kept.Add(new PolylineCurve(run));
        }
        return kept;
    }

    // Where segment a-b crosses the edge of the region x >= x0, y >= y0.
    static Point3d Crossing(Point3d a, Point3d b, double x0, double y0)
    {
        foreach (var t in new[] { (x0 - a.X) / (b.X - a.X), (y0 - a.Y) / (b.Y - a.Y) })
        {
            if (double.IsNaN(t) || double.IsInfinity(t) || t < 0 || t > 1) continue;
            var p = a + (b - a) * t;
            if (p.X >= x0 - 1e-6 && p.Y >= y0 - 1e-6) return p;
        }
        return a;
    }

    // A break line down through a slab of depth d at x: a zigzag bulging towards side (-1 left, +1 right).
    static List<Point3d> Break(Point3d top, double d, int side)
    {
        double w = 4 * side;
        return new List<Point3d>
        {
            new Point3d(top.X + w, top.Y - d * 0.4, 0), new Point3d(top.X - w, top.Y - d * 0.6, 0), new Point3d(top.X, top.Y - d, 0)
        };
    }

    static BoundingBox Box(List<Curve> curves)
    {
        var box = BoundingBox.Empty;
        foreach (var c in curves) box.Union(c.GetBoundingBox(true));
        return box;
    }

    static string Txt(object o, string fallback) { return o == null || o.ToString().Trim('"') == "" ? fallback : o.ToString().Trim('"'); }
    static double Num(object o, double fallback) { double v; return o != null && GH_Convert.ToDouble(o, out v, GH_Conversion.Both) ? v : fallback; }
}
