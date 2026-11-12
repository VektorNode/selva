// Grasshopper Script Instance
using System;
using System.Collections.Generic;
using System.Globalization;

using Rhino.Geometry;

using Grasshopper.Kernel;

public class Script_Instance : GH_ScriptInstance
{
    // A kitchen in millimetres. Each row of the Repeat is one cabinet: Keys, Labels, Sections, Fronts
    // and Handles arrive in row order, the picks already resolved, so row i of each list is cabinet i.
    // The back wall runs along +X from the origin with its fronts to -Y, the side wall turns along -Y
    // at its right-hand end, and the island stands in front of the back run. The room's two walls are
    // behind and to the right, so the default camera, which looks in from -X, -Y, sees every front.
    private void RunScript(List<object> Keys, List<object> Labels, List<object> Sections, List<object> Fronts, List<object> Handles,
        object WorktopName, object WallUnits, object LightsOn, object UnitHeight, object Ceiling,
        ref object Carcass, ref object Panels, ref object Glass, ref object Metal, ref object Steel, ref object Dark, ref object Top,
        ref object Splash, ref object Glow, ref object Walls, ref object Floor, ref object GlowStrength, ref object Lumens,
        ref object Lines, ref object Csv, ref object PartNames, ref object PartEur, ref object Total, ref object TopMetres)
    {
        var parts = new Parts();
        bool wallUnits = Truthy(WallUnits), lightsOn = Truthy(LightsOn);
        string worktop = Txt(WorktopName);
        // Wall units and tall cabinets end at the same height.
        double TallZ = WallZ0 + Num(UnitHeight, 700), Room = Num(Ceiling, 2500);

        var length = new Dictionary<string, double>();
        for (int i = 0; i < Keys.Count; i++)
        {
            string section = Txt(At(Sections, i));
            length[section] = (length.TryGetValue(section, out var l) ? l : 0) + WidthOf(Txt(Keys[i]));
        }
        double backLength = length.TryGetValue("Back wall", out var back) ? back : 0;
        bool hasSide = length.ContainsKey("Side wall");
        double islandLength = length.TryGetValue("Island", out var island) ? island : 0;

        var run = new Dictionary<string, double>();
        var low = new Dictionary<string, double>();
        double sinkAt = -1;
        var lines = new List<string>();
        var csv = new List<string> { "Cabinet,Wall,Width (mm),Front,Handle,EUR" };
        double carcassEur = 0, frontEur = 0, handleEur = 0, wallEur = 0, applianceEur = 0;

        for (int i = 0; i < Keys.Count; i++)
        {
            string key = Txt(Keys[i]), label = Txt(At(Labels, i)), section = Txt(At(Sections, i));
            string front = Txt(At(Fronts, i)), handle = Txt(At(Handles, i));
            bool tall = key.EndsWith("larder"), sink = key.EndsWith("sink"), hob = key.EndsWith("hob");
            bool open = front == "Open shelves", shelves = open || front == "Glazed door";
            double w = WidthOf(key);
            double u0 = run.TryGetValue(section, out var used) ? used : 0;
            run[section] = u0 + w;
            var wall = Wall(section, backLength, islandLength);

            var cabinet = new Cabinet(wall, u0, w, 0, tall ? TallZ : CarcassZ, 0, plinth: true);
            cabinet.Carcass(parts, shelves, top: !sink);
            int pulls = cabinet.Fronts(front, handle, parts);

            double rowCarcass = tall ? 420 : open ? 150 : 190 * w / 600;
            double rowFront = FrontEur(front) * w / 600 * (tall ? 2 : 1);
            double rowHandle = HandleEur(handle) * pulls;
            double rowWall = 0;

            if (!tall)
            {
                low[section] = u0 + w;
                if (sink)
                {
                    SinkAndTap(cabinet, w, parts);
                    sinkAt = u0;
                    applianceEur += 380;
                }

                if (hob)
                {
                    parts.Dark.Add(cabinet.Box(110, w - 110, 70, 490, TopZ, TopZ + 6));
                    foreach (var (du, dv, r) in new[] { (-140.0, 170.0, 95.0), (140.0, 170.0, 75.0), (-140.0, 390.0, 75.0), (140.0, 390.0, 95.0) })
                    {
                        parts.Steel.Add(Cyl(cabinet.At(w / 2 + du, dv, TopZ + 6), Vector3d.ZAxis, r, 1));
                    }
                    applianceEur += 520;
                }

                if (key == "back/prep") parts.Glass.Add(Cyl(cabinet.At(w / 2, 430, TopZ), Vector3d.ZAxis, 45, 230));

                if (section != "Island")
                {
                    if (hob)
                    {
                        parts.Steel.Add(cabinet.Box(0, w, Depth - 480, Depth, WallZ0, WallZ0 + 60));
                        parts.Steel.Add(cabinet.Box(w / 2 - 140, w / 2 + 140, Depth - 300, Depth, WallZ0 + 60, TallZ));
                        parts.Glow.Add(cabinet.Box(w / 2 - 160, w / 2 + 160, Depth - 300, Depth - 260, WallZ0 - 6, WallZ0));
                        applianceEur += 340;
                    }
                    else if (wallUnits)
                    {
                        var unit = new Cabinet(wall, u0, w, WallZ0, TallZ, Depth - WallDepth, plinth: false);
                        unit.Carcass(parts, shelves, top: true);
                        int unitPulls = unit.Fronts(WallFront(front), handle == "Cup pull" ? "Knob" : handle, parts);
                        parts.Glow.Add(unit.Box(20, w - 20, 40, 60, WallZ0 - 6, WallZ0));
                        rowWall = 150 * w / 600 + FrontEur(WallFront(front)) * w / 600 * 0.8 + HandleEur(handle) * unitPulls;
                    }
                    else
                    {
                        parts.Top.Add(cabinet.Box(0, w, Depth - 250, Depth, WallZ0, WallZ0 + 30));
                        parts.Glow.Add(cabinet.Box(20, w - 20, Depth - 70, Depth - 50, WallZ0 - 6, WallZ0));
                    }
                }
            }

            carcassEur += rowCarcass;
            frontEur += rowFront;
            handleEur += rowHandle;
            wallEur += rowWall;
            double rowEur = Math.Round(rowCarcass + rowFront + rowHandle + rowWall);
            lines.Add(string.Format(CultureInfo.InvariantCulture, "{0} · {1}: {2} / {3} · EUR {4:0}", label, section, front, handle, rowEur));
            csv.Add(string.Format(CultureInfo.InvariantCulture, "{0},{1},{2:0},{3},{4},{5:0}", label, section, w, front, handle, rowEur));
        }

        var backWall = Wall("Back wall", backLength, islandLength);
        double backLow = low.TryGetValue("Back wall", out var bl) ? bl : 0;
        double topMetres = backLow / 1000;

        // The side wall leaves the corner between the two runs: a blind cabinet under the worktop.
        if (hasSide)
        {
            var corner = new Cabinet(backWall, backLength, Depth, 0, CarcassZ, 0, plinth: true);
            corner.Carcass(parts, shelves: false, top: true);
            if (wallUnits)
            {
                var filler = new Cabinet(backWall, backLength, Depth, WallZ0, TallZ, Depth - WallDepth, plinth: false);
                filler.Carcass(parts, shelves: false, top: true);
                parts.Panels.Add(filler.Box(Gap / 2, Depth - WallDepth - Gap / 2, -Board, 0, WallZ0 + Gap, TallZ - Gap));
            }
            else
            {
                parts.Top.Add(corner.Box(0, Depth, Depth - 250, Depth, WallZ0, WallZ0 + 30));
            }

            double sideLow = low.TryGetValue("Side wall", out var sl) ? sl : 0;
            var side = new Cabinet(Wall("Side wall", backLength, islandLength), 0, sideLow, 0, CarcassZ, 0, plinth: false);
            parts.Splash.Add(side.Box(-Depth, sideLow, Depth - 10, Depth, TopZ, WallZ0));
            parts.Top.Add(side.Slab(0, sideLow, -20, Depth, CarcassZ, TopZ, null));
            topMetres += (Depth + sideLow) / 1000;
            carcassEur += 160;
        }

        var backRun = new Cabinet(backWall, 0, backLow, 0, CarcassZ, 0, plinth: false);
        parts.Splash.Add(backRun.Box(0, backLow + (hasSide ? Depth : 0), Depth - 10, Depth, TopZ, WallZ0));
        // One slab per run, so its grain runs the length of the run: Selva lays wood along each part.
        parts.Top.Add(backRun.Slab(0, backLow + (hasSide ? Depth : 0), -20, Depth, CarcassZ, TopZ,
            sinkAt < 0 ? ((double, double, double, double)?)null : (sinkAt + SinkInset, sinkAt + WidthOf("back/sink") - SinkInset, SinkFront, SinkBack)));

        if (islandLength > 0)
        {
            // One slab over the island, 300 mm past its back for the stools.
            var slab = new Cabinet(Wall("Island", backLength, islandLength), 0, islandLength, 0, CarcassZ, 0, plinth: false);
            parts.Top.Add(slab.Slab(-20, islandLength + 20, -20, IslandTop, CarcassZ, TopZ, null));
            topMetres += islandLength / 1000 * 1.5;
            for (int s = 0; s < 3; s++)
            {
                double u = islandLength * (2 * s + 1) / 6;
                parts.Dark.Add(Cyl(slab.At(u, IslandTop + 80, 0), Vector3d.ZAxis, 180, 15));
                parts.Dark.Add(Cyl(slab.At(u, IslandTop + 80, 0), Vector3d.ZAxis, 22, 640));
                parts.Dark.Add(Cyl(slab.At(u, IslandTop + 80, 640), Vector3d.ZAxis, 175, 45));
                parts.Metal.Add(Cyl(slab.At(u, 440, 1650), Vector3d.ZAxis, 120, 150));
                parts.Glow.Add(Cyl(slab.At(u, 440, 1640), Vector3d.ZAxis, 100, 10));
                parts.Dark.Add(Cyl(slab.At(u, 440, 1800), Vector3d.ZAxis, 4, Room - 1800));
            }
        }

        // The room is only as big as the kitchen needs: the viewer frames everything it is given.
        double wallX = backLength + (hasSide ? Depth : 0);
        double sideLength = length.TryGetValue("Side wall", out var sideRun) ? sideRun : 0;
        double roomFront = -Math.Max(1700, Math.Max(sideLength + 500, islandLength > 0 ? 3100 : 0));
        var walls = new List<Mesh>
        {
            Mesh.CreateFromBox(new BoundingBox(-500, Depth, 0, wallX + 100, Depth + 100, Room), 1, 1, 1),
            Mesh.CreateFromBox(new BoundingBox(wallX, roomFront, 0, wallX + 100, Depth, Room), 1, 1, 1)
        };

        double worktopEur = Math.Round(topMetres * WorktopEur(worktop));
        csv.Add(string.Format(CultureInfo.InvariantCulture, "Worktop,{0},{1:0},,,{2:0}", worktop, topMetres * 1000, worktopEur));
        csv.Add(string.Format(CultureInfo.InvariantCulture, "Sink hob and hood,,,,,{0:0}", applianceEur));
        double total = Math.Round(carcassEur + frontEur + handleEur + wallEur) + worktopEur + applianceEur;
        csv.Add(string.Format(CultureInfo.InvariantCulture, "Total,,,,,{0:0}", total));

        Carcass = parts.Carcass;
        Panels = parts.Panels;
        Glass = parts.Glass;
        Metal = parts.Metal;
        Steel = parts.Steel;
        Dark = parts.Dark;
        Top = parts.Top;
        Splash = parts.Splash;
        Glow = parts.Glow;
        Walls = walls;
        Floor = new List<Mesh> { Mesh.CreateFromBox(new BoundingBox(-500, roomFront, -20, wallX + 100, Depth + 100, 0), 1, 1, 1) };
        GlowStrength = lightsOn ? 3.0 : 0.0;
        Lumens = lightsOn ? 500.0 : 0.0;
        Lines = string.Join("\n", lines);
        Csv = csv;
        PartNames = new List<string> { "Cabinets", "Fronts", "Handles", "Wall units", "Worktop", "Sink, hob and hood" };
        PartEur = new List<double> { Math.Round(carcassEur), Math.Round(frontEur), Math.Round(handleEur), Math.Round(wallEur), worktopEur, applianceEur };
        Total = string.Format(CultureInfo.InvariantCulture, "EUR {0:#,0}", total);
        TopMetres = string.Format(CultureInfo.InvariantCulture, "{0:0.0} m of {1}", topMetres, worktop.ToLowerInvariant());
    }

    const double Relief = 12, Depth = 600, Plinth = 120, Gap = 3, Board = 18, CarcassZ = 870, TopZ = 910, WallZ0 = 1450;
    const double WallDepth = 350, IslandTop = 900, SinkInset = 160, SinkFront = 90, SinkBack = 470;

    sealed class Parts
    {
        public readonly List<Mesh> Carcass = new List<Mesh>(), Panels = new List<Mesh>(), Glass = new List<Mesh>(), Metal = new List<Mesh>(),
            Steel = new List<Mesh>(), Dark = new List<Mesh>(), Top = new List<Mesh>(), Splash = new List<Mesh>(), Glow = new List<Mesh>();
    }

    static double WidthOf(string key)
    {
        switch (key)
        {
            case "back/sink":
            case "back/hob":
            case "side/crockery":
            case "island/cutlery":
            case "island/pans":
                return 800;
            case "island/end":
                return 400;
            default:
                return 600;
        }
    }

    static double FrontEur(string front)
    {
        switch (front)
        {
            case "Shaker door": return 110;
            case "Slab door": return 90;
            case "Push door": return 120;
            case "Glazed door": return 170;
            case "Shaker drawers": return 240;
            case "Slab drawers": return 220;
            case "Push drawers": return 260;
            default: return 60;
        }
    }

    static double HandleEur(string handle)
    {
        switch (handle)
        {
            case "Knob": return 8;
            case "Bar": return 14;
            case "Cup pull": return 12;
            case "Edge pull": return 18;
            default: return 0;
        }
    }

    static double WorktopEur(string worktop)
    {
        switch (worktop)
        {
            case "Walnut": return 260;
            case "Marble": return 420;
            case "Terrazzo": return 340;
            case "Slate": return 300;
            case "Concrete": return 240;
            case "Travertine": return 360;
            default: return 190;
        }
    }

    // A wall unit takes a door in the style of the cabinet under it.
    static string WallFront(string front)
    {
        if (front == "Open shelves" || front == "Glazed door") return front;
        return front.Replace("drawers", "door");
    }

    // Origin, run direction and the direction the fronts face.
    static (Point3d Origin, Vector3d Along, Vector3d Out) Wall(string section, double backLength, double islandLength)
    {
        switch (section)
        {
            case "Side wall": return (new Point3d(backLength, 0, 0), -Vector3d.YAxis, -Vector3d.XAxis);
            case "Island": return (new Point3d(Math.Max(0, (backLength - islandLength) / 2), -1500 - Depth, 0), Vector3d.XAxis, -Vector3d.YAxis);
            default: return (Point3d.Origin, Vector3d.XAxis, -Vector3d.YAxis);
        }
    }

    static void SinkAndTap(Cabinet cabinet, double w, Parts parts)
    {
        const double ua = SinkInset, va = SinkFront, vb = SinkBack, floor = 700;
        double ub = w - SinkInset;
        parts.Steel.Add(cabinet.Box(ua, ub, va, vb, floor, floor + 4));
        parts.Steel.Add(cabinet.Box(ua, ua + 4, va, vb, floor, TopZ + 2));
        parts.Steel.Add(cabinet.Box(ub - 4, ub, va, vb, floor, TopZ + 2));
        parts.Steel.Add(cabinet.Box(ua, ub, va, va + 4, floor, TopZ + 2));
        parts.Steel.Add(cabinet.Box(ua, ub, vb - 4, vb, floor, TopZ + 2));

        parts.Metal.Add(Cyl(cabinet.At(w / 2, 530, TopZ), Vector3d.ZAxis, 26, 12));
        parts.Metal.Add(Cyl(cabinet.At(w / 2, 530, TopZ), Vector3d.ZAxis, 11, 300));
        parts.Metal.Add(cabinet.Box(w / 2 - 9, w / 2 + 9, 330, 541, TopZ + 282, TopZ + 300));
        parts.Metal.Add(Cyl(cabinet.At(w / 2, 340, TopZ + 245), Vector3d.ZAxis, 9, 40));
    }

    static Mesh Cyl(Point3d from, Vector3d axis, double radius, double height) =>
        Mesh.CreateFromCylinder(new Cylinder(new Circle(new Plane(from, axis), radius), height), 1, 32, true, true);

    sealed class Cabinet
    {
        readonly (Point3d Origin, Vector3d Along, Vector3d Out) wall;
        readonly double u0, width, z0, z1, vFront, depth, bottom;
        // Where a pull meets its front: a Shaker frame stands proud of the panel.
        double face = -Board;

        // vFront is how far the cabinet's front sits behind the base cabinets' front plane.
        public Cabinet((Point3d, Vector3d, Vector3d) wall, double u0, double width, double z0, double z1, double vFront, bool plinth)
        {
            this.wall = wall; this.u0 = u0; this.width = width; this.z0 = z0; this.z1 = z1; this.vFront = vFront;
            depth = Depth - vFront;
            bottom = plinth ? z0 + Plinth : z0;
        }

        // u along the run, v from the front (0) to the back, z up. Negative v is in front.
        public Point3d At(double u, double v, double z) =>
            wall.Origin + wall.Along * (u0 + u) - wall.Out * (vFront + v) + Vector3d.ZAxis * z;

        public Mesh Box(double ua, double ub, double va, double vb, double za, double zb) =>
            Mesh.CreateFromBox(new BoundingBox(new[] { At(ua, va, za), At(ub, vb, zb) }), 1, 1, 1);

        /// <summary>A board as one mesh, with an optional rectangular cut-out (ua, ub, va, vb).</summary>
        public Mesh Slab(double ua, double ub, double va, double vb, double za, double zb, (double Ua, double Ub, double Va, double Vb)? hole)
        {
            Curve Rect(double a, double b, double c, double d) =>
                new Polyline(new[] { At(a, c, za), At(b, c, za), At(b, d, za), At(a, d, za), At(a, c, za) }).ToNurbsCurve();
            var outline = new List<Curve> { Rect(ua, ub, va, vb) };
            if (hole.HasValue) outline.Add(Rect(hole.Value.Ua, hole.Value.Ub, hole.Value.Va, hole.Value.Vb));
            var solid = Brep.CreateFromOffsetFace(Brep.CreatePlanarBreps(outline, 0.01)[0].Faces[0], zb - za, 0.01, false, true);
            // The face's normal decides which way the offset went.
            double below = za - solid.GetBoundingBox(true).Min.Z;
            if (below > 1) solid.Translate(0, 0, below);
            var slab = new Mesh();
            foreach (var face in Mesh.CreateFromBrep(solid, MeshingParameters.FastRenderMesh)) slab.Append(face);
            return slab;
        }

        public void Carcass(Parts parts, bool shelves, bool top)
        {
            var into = parts.Carcass;
            into.Add(Box(0, Board, 0, depth, bottom, z1));
            into.Add(Box(width - Board, width, 0, depth, bottom, z1));
            into.Add(Box(Board, width - Board, 0, depth, bottom, bottom + Board));
            into.Add(Box(Board, width - Board, depth - 6, depth, bottom, z1));
            if (top) into.Add(Box(Board, width - Board, 0, depth, z1 - Board, z1));
            if (bottom > z0) parts.Dark.Add(Box(0, width, 50, depth, z0, bottom));
            if (!shelves) return;
            int bays = Math.Max(2, (int)Math.Round((z1 - bottom) / 380));
            for (int s = 1; s < bays; s++)
            {
                double z = bottom + s * (z1 - bottom) / bays;
                into.Add(Box(Board, width - Board, 10, depth - 6, z, z + Board));
            }
        }

        /// <summary>Draws the fronts and returns how many pulls they took.</summary>
        public int Fronts(string front, string handle, Parts parts)
        {
            if (front == "Open shelves") return 0;
            face = front.StartsWith("Shaker") ? -Board - Relief : -Board;
            double f0 = bottom + Gap, f1 = z1 - Gap;
            if (!front.EndsWith("drawers")) return Doors(front, handle, parts, f0, f1);

            // A tall cabinet takes two drawers under worktop height and a door above.
            if (z1 - z0 < 1000) return Drawers(front, handle, parts, f0, f1, 3);
            return Drawers(front, handle, parts, f0, CarcassZ - Gap / 2, 2) +
                   Doors(front.Replace("drawers", "door"), handle, parts, CarcassZ + Gap / 2, f1);
        }

        int Drawers(string front, string handle, Parts parts, double f0, double f1, int count)
        {
            for (int i = 0; i < count; i++)
            {
                double za = f0 + i * (f1 - f0) / count + Gap / 2, zb = f0 + (i + 1) * (f1 - f0) / count - Gap / 2;
                Leaf(front, parts, Gap, width - Gap, za, zb);
                Pull(handle, parts.Metal, width / 2, zb - 60, Gap, width - Gap, za, zb, horizontal: true, opensRight: true);
            }
            return handle == "None" ? 0 : count;
        }

        int Doors(string front, string handle, Parts parts, double f0, double f1)
        {
            int count = width > 700 ? 2 : 1;
            for (int i = 0; i < count; i++)
            {
                double ua = i * width / count + Gap / 2, ub = (i + 1) * width / count - Gap / 2;
                Leaf(front, parts, ua, ub, f0, f1);

                // A pair opens in the middle. The pull sits low on a wall unit, at hand height on a
                // tall door, and near the top of a base door.
                bool right = count == 1 || i == 0;
                double z = z0 >= 1000 ? f0 + 120 : f1 > 1500 ? Math.Max(f0 + 120, 1050) : f1 - 120;
                Pull(handle, parts.Metal, right ? ub - 50 : ua + 50, z, ua, ub, f0, f1, horizontal: false, opensRight: right);
            }
            return handle == "None" ? 0 : count;
        }

        void Leaf(string front, Parts parts, double ua, double ub, double za, double zb)
        {
            if (front == "Glazed door")
            {
                Frame(parts.Panels, ua, ub, za, zb, 60, -Board, 0);
                parts.Glass.Add(Box(ua + 60, ub - 60, -Board / 2 - 2, -Board / 2 + 2, za + 60, zb - 60));
                return;
            }
            parts.Panels.Add(Box(ua, ub, -Board, 0, za, zb));
            if (front.StartsWith("Shaker")) Frame(parts.Panels, ua, ub, za, zb, 60, -Board - Relief, -Board);
        }

        void Frame(List<Mesh> into, double ua, double ub, double za, double zb, double rail, double va, double vb)
        {
            into.Add(Box(ua, ub, va, vb, za, za + rail));
            into.Add(Box(ua, ub, va, vb, zb - rail, zb));
            into.Add(Box(ua, ua + rail, va, vb, za + rail, zb - rail));
            into.Add(Box(ub - rail, ub, va, vb, za + rail, zb - rail));
        }

        void Pull(string handle, List<Mesh> into, double u, double z, double ua, double ub, double za, double zb, bool horizontal, bool opensRight)
        {
            switch (handle)
            {
                case "Knob":
                    into.Add(Cyl(At(u, face, z), wall.Out, 14, 24));
                    break;
                case "Bar":
                    if (horizontal) into.Add(Box(u - 80, u + 80, face - 24, face, z - 6, z + 6));
                    else into.Add(Box(u - 6, u + 6, face - 24, face, z - 80, z + 80));
                    break;
                case "Cup pull":
                    into.Add(Box(u - 45, u + 45, face - 18, face, z - 14, z + 6));
                    break;
                case "Edge pull":
                    // Along the top of a drawer or base door, the bottom of a wall unit, the opening edge of a tall door.
                    if (horizontal || zb - za < 1000 && z0 < 1000) into.Add(Box(ua + 20, ub - 20, face - 10, face, zb - 4, zb + 8));
                    else if (z0 >= 1000) into.Add(Box(ua + 20, ub - 20, face - 10, face, za - 8, za + 4));
                    else if (opensRight) into.Add(Box(ub - 4, ub + 8, face - 10, face, z - 120, z + 120));
                    else into.Add(Box(ua - 8, ua + 4, face - 10, face, z - 120, z + 120));
                    break;
            }
        }
    }

    static object At(List<object> list, int i) => i < list.Count ? list[i] : null;
    static string Txt(object o) { return o == null ? "" : o.ToString().Trim('"'); }
    static double Num(object o, double fallback) { return o != null && double.TryParse(o.ToString().Trim('"'), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : fallback; }
    static bool Truthy(object o) { return o is bool flag ? flag : o != null && o.ToString().Equals("true", StringComparison.OrdinalIgnoreCase); }
}
