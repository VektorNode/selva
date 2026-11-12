// Grasshopper Script Instance
using System;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;

using Rhino;
using Rhino.Geometry;

using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;

public class Script_Instance : GH_ScriptInstance
{
    // A desk lamp in millimetres, base on the desk at the origin, reaching along +X. Besides the parts
    // it reports the beam the light script needs, whether the lamp stands, and a priced parts list.
    // The shade's profile and the light sources that fit it come from the head script.
    private void RunScript(
		object Base, object BaseSize, object DeskThickness, object Weighted,
		object Arm, object Height, object Reach, object Elbow, object Tilt,
		object Head, object HeadSize, object BarLength, object Diffuser, object CableOn,
		List<object> Profile, List<object> Sources, object Source, object LightOn,
		ref object Body, ref object Trim, ref object Inner, ref object Glass, ref object Light, ref object Cable,
		ref object Desk, ref object Props, ref object Lumens,
		ref object Beam, ref object Spread, ref object Cutoff, ref object Efficiency,
		ref object Steady, ref object GlareFree,
		ref object SourceName, ref object PowerW, ref object Stability, ref object WeightKg,
		ref object PartNames, ref object PartNotes, ref object PartEur)
    {
        string baseType = Txt(Base, "Round"), arm = Txt(Arm, "Two-Joint"), head = Txt(Head, "Dome");
        double size = Num(BaseSize, 180), deskT = Num(DeskThickness, 30), h = Num(Height, 480), reach = Num(Reach, 360);
        double elbow = Num(Elbow, 45) / 100.0, tilt = Num(Tilt, 25) * Math.PI / 180, headSize = Num(HeadSize, 170), barLen = Num(BarLength, 420);
        bool heavy = Bool(Weighted, false), diffuser = Bool(Diffuser, true), cableOn = Bool(CableOn, true), lightOn = Bool(LightOn, true);

        var body = new List<Mesh>(); var inner = new List<Mesh>(); var glass = new List<Mesh>();
        var light = new List<Mesh>(); var cable = new List<Mesh>(); var desk = new List<Mesh>();
        var trim = new List<Mesh>(); var props = new List<Mesh>();

        bool clamp = baseType == "Clamp";
        bool bar = head == "Linear Bar";

        // Desk: a clamp needs an edge, so the desk starts at the lamp.
        double deskFrom = clamp ? 0 : -300, deskTo = Math.Max(reach + 260, 620);
        desk.Add(Mesh.CreateFromBox(new BoundingBox(deskFrom, -300, -deskT, deskTo, 300, 0), 1, 1, 1));

        // Base
        double baseTop, baseMassKg, footprint;
        if (baseType == "Square")
        {
            double t = heavy ? 30 : 16;
            var rr = RoundedRect(size, size * 0.8, 16);
            body.Add(ToMesh(Extrusion.Create(rr, t, true).ToBrep()));
            baseTop = t; footprint = size / 2;
            baseMassKg = size * size * 0.8 * t * 7.85e-6;
        }
        else if (clamp)
        {
            // One C-section gripping the desk edge at x = 0, tightened by a screw from below.
            const double top = 12, width = 52, rear = -12, front = 92, screw = 62;
            var section = new Polyline(new[]
            {
                new Point3d(rear, -deskT - 16, 0), new Point3d(front, -deskT - 16, 0), new Point3d(front, -deskT - 6, 0), new Point3d(0, -deskT - 6, 0),
                new Point3d(0, 0, 0), new Point3d(front, 0, 0), new Point3d(front, top, 0), new Point3d(rear, top, 0), new Point3d(rear, -deskT - 16, 0)
            }).ToNurbsCurve();
            var rounded = Curve.CreateFilletCornersCurve(section, 2, 0.01, 0.1) ?? section;
            var jaw = ToMesh(Extrusion.Create(rounded, width, true).ToBrep());
            jaw.Transform(Transform.Rotation(Math.PI / 2, Vector3d.XAxis, Point3d.Origin));
            var box = jaw.GetBoundingBox(true);
            jaw.Transform(Transform.Translation(0, -(box.Min.Y + box.Max.Y) / 2, 0));
            body.Add(jaw);
            body.Add(ToMesh(Tube(new LineCurve(new Point3d(screw, 0, -deskT - 56), new Point3d(screw, 0, -deskT - 5)), 6)));
            body.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(screw, 0, -deskT - 5), Vector3d.ZAxis), 14), 5).ToBrep(true, true)));
            body.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(screw, 0, -deskT - 68), Vector3d.ZAxis), 15), 12).ToBrep(true, true)));
            baseTop = top; footprint = 0; baseMassKg = 0.65;
        }
        else
        {
            double t = heavy ? 30 : 16, R = size / 2, r = 6;
            var pts = new List<Point3d> { new Point3d(0, 0, 0), new Point3d(R, 0, 0), new Point3d(R, 0, t - r) };
            var profile = new PolyCurve();
            profile.Append(new Line(pts[0], pts[1]));
            profile.Append(new Line(pts[1], pts[2]));
            profile.Append(new Arc(pts[2], Vector3d.ZAxis, new Point3d(R - r, 0, t)));
            profile.Append(new Line(new Point3d(R - r, 0, t), new Point3d(0, 0, t)));
            body.Add(ToMesh(Revolve(profile)));
            baseTop = t; footprint = R;
            baseMassKg = Math.PI * R * R * t * 7.85e-6;
        }

        if (!clamp)
            trim.Add(Mesh.CreateFromBox(new BoundingBox(-footprint * 0.62 - 11, -7, baseTop - 1, -footprint * 0.62 + 11, 7, baseTop + 3.5), 1, 1, 1));

        // Arm: pivot at the base, head knuckle at (reach, 0, height).
        var pivot = new Point3d(clamp ? 36 : 0, 0, baseTop + 22);
        var knuckle = new Point3d(reach, 0, h);
        body.Add(ToMesh(Tube(new LineCurve(new Point3d(pivot.X, 0, baseTop - 1), pivot), 11)));
        body.Add(ToMesh(Joint(pivot, 15, 38)));
        trim.Add(ToMesh(Knob(pivot, 38)));

        double armLen, armRadius;
        var armPath = new List<Curve>();
        if (arm == "Straight")
        {
            var c = new LineCurve(pivot, knuckle);
            body.Add(ToMesh(Tube(c, 9)));
            armLen = c.GetLength(); armRadius = 9;
            armPath.Add(c);
        }
        else if (arm == "Arc")
        {
            var c = new ArcCurve(new Arc(pivot, Vector3d.ZAxis, knuckle));
            body.Add(ToMesh(Tube(c, 8)));
            armLen = c.GetLength(); armRadius = 8;
            armPath.Add(c);
        }
        else
        {
            var e = new Point3d(pivot.X + reach * (elbow - 0.42), 0, baseTop + (h - baseTop) * 0.66);
            foreach (double y in new[] { -10.0, 10.0 })
            {
                var off = new Vector3d(0, y, 0);
                body.Add(ToMesh(Tube(new LineCurve(pivot + off, e + off), 5)));
                body.Add(ToMesh(Tube(new LineCurve(e + off, knuckle + off), 5)));
            }
            body.Add(ToMesh(Joint(e, 13, 34)));
            trim.Add(ToMesh(Knob(e, 34)));
            armLen = pivot.DistanceTo(e) + e.DistanceTo(knuckle); armRadius = 5;
            armPath.Add(new LineCurve(pivot, e)); armPath.Add(new LineCurve(e, knuckle));
        }

        // Head: local +Z is the light direction.
        var dir = new Vector3d(Math.Sin(tilt), 0, -Math.Cos(tilt));
        var x = Vector3d.CrossProduct(Vector3d.YAxis, dir);
        var outer = Profile.Select(ToPoint).ToList();
        if (outer.Count < 2) outer = new List<Point3d> { new Point3d(23, 0, 0), new Point3d(23, 0, 28) };
        double depth = outer[outer.Count - 1].Z, mouth = outer[outer.Count - 1].X;
        var sources = Sources.Select(o => Lamp.Parse(Txt(o, ""))).Where(o => o != null).ToList();
        var src = sources.FirstOrDefault(o => o.Id == Txt(Source, "")) ?? sources.FirstOrDefault()
            ?? Lamp.Parse("module-6|LED module 6 W|600|6|11|40|18|module|0|5");

        // A wide head on a short reach swallows its own arm, so the head moves out on a neck until it clears.
        double neck = NeckToClear(knuckle, dir, x, armPath, armRadius, outer);
        var mount = knuckle + Vector3d.XAxis * neck;
        body.Add(ToMesh(new Sphere(knuckle, 13).ToBrep()));
        trim.Add(ToMesh(Joint(knuckle, 5.5, 34)));
        if (neck > 0)
        {
            body.Add(ToMesh(Tube(new LineCurve(knuckle, mount), 6)));
            body.Add(ToMesh(new Sphere(mount, 10).ToBrep()));
        }
        var c0 = mount + dir * 30;
        body.Add(ToMesh(Tube(new LineCurve(mount, c0), 6)));
        var frame = new Plane(c0, x, Vector3d.CrossProduct(dir, x));
        var toHead = Transform.PlaneToPlane(Plane.WorldXY, frame);

        double headMassKg, lightZ;
        if (bar)
        {
            var section = RoundedRect(46, 28, 11);
            var bodyMesh = ToMesh(Extrusion.Create(section, barLen, true).ToBrep());
            bodyMesh.Transform(Transform.Translation(0, 0, -barLen / 2));
            bodyMesh.Transform(Transform.Rotation(Math.PI / 2, Vector3d.XAxis, Point3d.Origin));
            bodyMesh.Transform(Transform.Translation(0, 0, 14));
            bodyMesh.Transform(toHead);
            body.Add(bodyMesh);
            var strip = Mesh.CreateFromBox(new BoundingBox(-16, -barLen / 2 + 12, 26, 16, barLen / 2 - 12, 29), 1, 1, 1);
            strip.Transform(toHead);
            light.Add(strip);
            headMassKg = 0.2 + barLen / 1000 * 0.7;
            lightZ = 27;
        }
        else
        {
            var skin = Curve.CreateInterpolatedCurve(outer, 3);
            if (head == "Cone" || head == "Cylinder") skin = new Polyline(outer).ToNurbsCurve();
            var shell = ToMesh(Revolve(skin)); shell.Transform(toHead); body.Add(shell);

            var offset = outer.Select(p => new Point3d(Math.Max(p.X - 2.5, 0.01), 0, p.Z + 1.5)).ToList();
            var liner = Curve.CreateInterpolatedCurve(offset, 3);
            if (head == "Cone" || head == "Cylinder") liner = new Polyline(offset).ToNurbsCurve();
            var linerMesh = ToMesh(Revolve(liner)); linerMesh.Transform(toHead); inner.Add(linerMesh);

            var rim = ToMesh(new Torus(new Plane(new Point3d(0, 0, depth), Vector3d.ZAxis), mouth - 0.5, 3.2).ToNurbsSurface().ToBrep());
            rim.Transform(toHead); body.Add(rim);

            var collar = ToMesh(new Cylinder(new Circle(new Plane(new Point3d(0, 0, -12), Vector3d.ZAxis), 15), 16).ToBrep(true, true));
            collar.Transform(toHead); body.Add(collar);

            foreach (var part in BulbMeshes(src, src.Seat, out lightZ)) { part.Transform(toHead); light.Add(part); }

            if (diffuser)
            {
                var lens = ToMesh(new Cylinder(new Circle(new Plane(new Point3d(0, 0, depth - 2), Vector3d.ZAxis), mouth - 2.5), 2.5).ToBrep(true, true));
                lens.Transform(toHead); glass.Add(lens);
            }
            headMassKg = 0.2 + Math.Pow(headSize / 170, 2) * 0.3;
        }

        // Cable: hidden inside a tube arm, or threaded between twin rods over saddles. It leaves the back
        // of the base through a strain relief and runs flat on the desk to a grommet. A clamp has no
        // desk behind it, so there it drops off the edge.
        if (cableOn)
        {
            const double r = 2.6;
            if (arm != "Straight" && arm != "Arc")
                foreach (var link in armPath)
                {
                    cable.Add(ToMesh(Tube(link, r)));
                    var along = link.PointAtEnd - link.PointAtStart; along.Unitize();
                    var below = Vector3d.CrossProduct(along, Vector3d.YAxis);
                    if (below.Z > 0) below = -below;
                    foreach (double t in new[] { 0.3, 0.7 })
                    {
                        var at = link.PointAtNormalizedLength(t) + below * (r + 2);
                        body.Add(ToMesh(Tube(new LineCurve(at - Vector3d.YAxis * 10, at + Vector3d.YAxis * 10), 2)));
                    }
                }

            double exit = clamp ? -12 : -footprint;
            double exitZ = clamp ? 6 : 5;
            cable.Add(ToMesh(Tube(new LineCurve(new Point3d(exit + 2, 0, exitZ), new Point3d(exit - 12, 0, exitZ)), 4.6)));
            cable.Add(ToMesh(Tube(new LineCurve(new Point3d(exit - 10, 0, exitZ), new Point3d(exit - 24, 0, exitZ)), 3.7)));

            List<Point3d> route;
            Vector3d arrival;
            if (clamp)
            {
                double drop = exit - 54;
                route = new List<Point3d> { new Point3d(exit, 0, exitZ), new Point3d(exit - 28, 0, exitZ), new Point3d(drop, 0, -24), new Point3d(drop, 0, -deskT - 240) };
                arrival = -Vector3d.ZAxis;
            }
            else
            {
                const double gx = -262, gy = 84, flat = r + 0.1, bend = 9;
                double settled = exit - 40;
                var entry = new Point3d(gx + bend, gy, flat);
                route = new List<Point3d>
                {
                    new Point3d(exit, 0, exitZ), new Point3d(exit - 26, 0, exitZ), new Point3d(settled, 0, flat), new Point3d(gx + 70, gy, flat), entry
                };
                arrival = -Vector3d.XAxis;

                // Flat to the hole, then one bend down: a spline through both wriggles on the desk.
                cable.Add(ToMesh(Tube(new ArcCurve(new Arc(entry, -Vector3d.XAxis, new Point3d(gx, gy, flat - bend))), r)));
                var grommet = new Point3d(gx, gy, 0.2);
                cable.Add(ToMesh(new Torus(new Plane(grommet, Vector3d.ZAxis), 13, 1).ToNurbsSurface().ToBrep()));
                cable.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(gx, gy, 0), Vector3d.ZAxis), 12.5), 0.2).ToBrep(true, true)));
            }
            cable.Add(ToMesh(Tube(Curve.CreateInterpolatedCurve(route, 3, CurveKnotStyle.Chord, -Vector3d.XAxis, arrival), r)));
        }

        // On the desk: a sketchbook where the light falls, a pencil and a mug.
        double bookX = Math.Max(reach + 60, footprint + 150);
        var onDesk = Transform.Translation(bookX, -110, 0) * Transform.Rotation(0.2, Vector3d.ZAxis, Point3d.Origin);
        foreach (var part in new[]
        {
            Tuple.Create(trim, Mesh.CreateFromBox(new BoundingBox(-105, -74, 0, 105, 74, 2.5), 1, 1, 1)),
            Tuple.Create(props, Mesh.CreateFromBox(new BoundingBox(-101, -71, 2.5, 102, 71, 12), 1, 1, 1)),
            Tuple.Create(trim, Mesh.CreateFromBox(new BoundingBox(-105, -74, 12, 105, 74, 14.5), 1, 1, 1)),
            Tuple.Create(trim, ToMesh(Tube(new LineCurve(new Point3d(-80, -104, 3.7), new Point3d(95, -96, 3.7)), 3.6))),
        })
        {
            part.Item2.Transform(onDesk);
            part.Item1.Add(part.Item2);
        }
        var mugAt = Transform.Translation(Math.Min(bookX + 185, deskTo - 60), 165, 0);
        var mugWall = new Polyline(new[]
        {
            new Point3d(0.01, 0, 0), new Point3d(36, 0, 0), new Point3d(40, 0, 6), new Point3d(40, 0, 92), new Point3d(36.5, 0, 92),
            new Point3d(36.5, 0, 7), new Point3d(0.01, 0, 5)
        }).ToNurbsCurve();
        var handle = new ArcCurve(new Arc(new Point3d(39, 0, 74), new Point3d(64, 0, 48), new Point3d(39, 0, 22)));
        foreach (var part in new[] { ToMesh(Revolve(mugWall)), ToMesh(Tube(handle, 4.5)) })
        {
            part.Transform(mugAt);
            props.Add(part);
        }

        // Tipping about the base edge on the head's side.
        double armMassKg = armLen / 1000 * 0.55;
        double baseKg = heavy ? baseMassKg : baseMassKg * 0.75;
        double overturn = headMassKg * (reach + neck - footprint) + armMassKg * (reach / 2 - footprint);
        double margin = clamp || overturn <= 0 ? double.PositiveInfinity : baseKg * footprint / overturn;
        string stability;
        if (clamp) stability = "Clamped to the desk";
        else if (overturn <= 0) stability = "Stable: the head sits inside the base";
        else stability = margin >= 1.25 ? string.Format(Inv, "Stable, {0:0.0}x margin", margin)
            : margin >= 1 ? string.Format(Inv, "Marginal, {0:0.0}x: widen or weight the base", margin)
            : string.Format(Inv, "Tips over at {0:0.0}x: widen or weight the base", margin);

        // Parts at list price before the finish. The Price section adds the finish and the quantity break.
        var parts = new List<Tuple<string, string, double>>
        {
            Tuple.Create("Base", clamp ? "Desk clamp, steel" : string.Format(Inv, "{0}, {1}{2:0} mm, {3} mm steel", baseType, baseType == "Round" ? "Ø" : "", size, heavy ? 30 : 16), clamp ? 22 : 10 + baseKg * 7),
            Tuple.Create("Arm", string.Format(Inv, "{0}, {1:0} mm", arm, armLen), 8 + armLen * 0.05),
            Tuple.Create("Head", bar ? string.Format(Inv, "Linear bar, {0:0} mm", barLen) : string.Format(Inv, "{0}, Ø{1:0} mm", head, headSize), bar ? barLen * 0.09 : headSize * 0.22),
            Tuple.Create("Light source", string.Format(Inv, "{0}, {1:#,0} lm", src.Name, src.Lm), src.Price),
            Tuple.Create("Diffuser", "Frosted glass", diffuser && !bar ? 9.0 : 0),
            Tuple.Create("Cable", "Textile, 2 m, strain relief", cableOn ? 6.0 : 0),
            Tuple.Create("Assembly", "Wiring, test and pack", 16.0),
        }.Where(p => p.Item3 > 0).ToList();

        // Light: the beam leaves the source along the head's axis. n says how tightly the shade focuses
        // it; a diffuser softens it and takes some of the light.
        double n = head == "Cylinder" ? 6 : head == "Cone" ? 3 : bar ? 1 : 1.5;
        if (diffuser && !bar) n *= 0.7;
        double cutoff = bar ? 80 : Math.Min(Math.Atan2(mouth, Math.Max(depth - lightZ, 5)) * 180 / Math.PI, 85);

        Body = body; Trim = trim; Inner = inner; Glass = glass; Light = light; Cable = cable; Desk = desk; Props = props;
        Lumens = lightOn ? src.Lm : 0;
        Beam = new Plane(c0 + dir * lightZ, dir);
        Spread = n;
        Cutoff = cutoff;
        Efficiency = (bar ? 0.9 : 0.8) * (diffuser && !bar ? 0.85 : 1);
        Steady = margin >= 1;
        // A bare source standing out of the rim shines straight into the eye.
        GlareFree = bar || diffuser || src.Tip <= depth;
        SourceName = string.Format(Inv, "{0}, {1:#,0} lm", src.Name, src.Lm);
        PowerW = Math.Round(src.W, 1);
        Stability = stability;
        WeightKg = Math.Round(baseKg + headMassKg + armMassKg + (cableOn ? 0.08 : 0), 2);
        PartNames = parts.Select(p => p.Item1).ToList();
        PartNotes = parts.Select(p => p.Item2).ToList();
        PartEur = parts.Select(p => Math.Round(p.Item3, 2)).ToList();
    }

    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // A light source as the head script lists it: id|name|lm|W|EUR|diameter|length|kind|seat|tip.
    class Lamp
    {
        public string Id, Name, Kind; public double Lm, W, Price, Dia, Len, Seat, Tip;
        public static Lamp Parse(string line)
        {
            var f = line.Split('|');
            if (f.Length < 10) return null;
            Func<int, double> n = i => double.Parse(f[i], Inv);
            return new Lamp { Id = f[0], Name = f[1], Lm = n(2), W = n(3), Price = n(4), Dia = n(5), Len = n(6), Kind = f[7], Seat = n(8), Tip = n(9) };
        }
    }

    // The source in the head's frame, from its seat. lightZ is where it emits from.
    static List<Mesh> BulbMeshes(Lamp s, double seat, out double lightZ)
    {
        var parts = new List<Mesh>();
        if (s.Kind == "module")
        {
            parts.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(0, 0, seat + 2), Vector3d.ZAxis), s.Dia / 2), 3).ToBrep(true, true)));
            lightZ = seat + 5;
        }
        else if (s.Kind == "spot")
        {
            parts.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(0, 0, seat), Vector3d.ZAxis), s.Dia / 2), s.Len - 12).ToBrep(true, true)));
            lightZ = seat + s.Len - 14;
        }
        else
        {
            double centre = s.Len - 12 - s.Dia / 2;
            parts.Add(ToMesh(new Cylinder(new Circle(new Plane(new Point3d(0, 0, -12), Vector3d.ZAxis), 13.5), centre + 12).ToBrep(true, true)));
            parts.Add(ToMesh(new Sphere(new Point3d(0, 0, centre), s.Dia / 2).ToBrep()));
            lightZ = centre;
        }
        return parts;
    }

    static double NeckToClear(Point3d knuckle, Vector3d dir, Vector3d x, List<Curve> arm, double armRadius, List<Point3d> profile)
    {
        for (double neck = 0; neck < 500; neck += 10)
        {
            var head = knuckle + Vector3d.XAxis * neck + dir * 30;
            if (!arm.Any(c => Hits(c, head, dir, x, armRadius, profile))) return neck;
        }
        return 500;
    }

    static bool Hits(Curve arm, Point3d head, Vector3d dir, Vector3d x, double armRadius, List<Point3d> profile)
    {
        const double clearance = 6;
        for (int i = 0; i <= 80; i++)
        {
            double t;
            arm.NormalizedLengthParameter(i / 80.0, out t);
            var v = arm.PointAt(t) - head;
            double along = v * dir;
            if (along < -16 || along > profile[profile.Count - 1].Z) continue;
            if (Math.Abs(v * x) < WidthAt(profile, along) + armRadius + clearance) return true;
        }
        return false;
    }

    // Half-width of the head at a depth along its axis, the collar included.
    static double WidthAt(List<Point3d> profile, double depth)
    {
        for (int i = 1; i < profile.Count; i++)
        {
            Point3d a = profile[i - 1], b = profile[i];
            if (b.Z <= a.Z || depth > b.Z || depth < a.Z) continue;
            return Math.Max(15, a.X + (b.X - a.X) * (depth - a.Z) / (b.Z - a.Z));
        }
        return 15;
    }

    static Curve RoundedRect(double w, double d, double r)
    {
        var rect = new Rectangle3d(Plane.WorldXY, new Interval(-w / 2, w / 2), new Interval(-d / 2, d / 2));
        var c = Curve.CreateFilletCornersCurve(rect.ToNurbsCurve(), r, 0.01, 0.1);
        return c ?? rect.ToNurbsCurve();
    }

    static Brep Revolve(Curve c)
    {
        return Brep.CreateFromRevSurface(RevSurface.Create(c, new Line(Point3d.Origin, Vector3d.ZAxis, 10)), false, false);
    }

    static Brep Tube(Curve c, double r)
    {
        var pipes = Brep.CreatePipe(c, r, false, PipeCapMode.Round, true, 0.05, 0.02);
        return pipes[0];
    }

    static Brep Joint(Point3d at, double r, double width)
    {
        var plane = new Plane(at - Vector3d.YAxis * width / 2, Vector3d.YAxis);
        return new Cylinder(new Circle(plane, r), width).ToBrep(true, true);
    }

    // The tightening knob on one side of a joint.
    static Brep Knob(Point3d at, double width)
    {
        var plane = new Plane(at - Vector3d.YAxis * (width / 2 + 9), Vector3d.YAxis);
        return new Cylinder(new Circle(plane, 9), 9).ToBrep(true, true);
    }

    static Point3d ToPoint(object o) { var p = Point3d.Origin; GH_Convert.ToPoint3d(o, ref p, GH_Conversion.Both); return p; }

    static Mesh ToMesh(Brep b)
    {
        var mp = new MeshingParameters(0.85, 0.5) { JaggedSeams = false, RefineGrid = true };
        var m = new Mesh();
        foreach (var part in Mesh.CreateFromBrep(b, mp)) m.Append(part);
        m.Normals.ComputeNormals();
        return m;
    }

    static string Txt(object o, string fallback) { return o == null || o.ToString().Trim('"') == "" ? fallback : o.ToString().Trim('"'); }
    static double Num(object o, double fallback) { double v; return o != null && GH_Convert.ToDouble(o, out v, GH_Conversion.Both) ? v : fallback; }
    static bool Bool(object o, bool fallback) { bool v; return o != null && GH_Convert.ToBoolean(o, out v, GH_Conversion.Both) ? v : fallback; }
}
