// Grasshopper Script Instance
using System;
using System.Collections.Generic;

using Rhino.Geometry;

using Grasshopper.Kernel;

public class Script_Instance : GH_ScriptInstance
{
    // A kitchen in millimetres. Each row of the Repeat is one cabinet: Keys, Sections, Fronts and
    // Handles arrive in row order, the picks already resolved, so row i of each list is cabinet i.
    // The back wall runs along +X from the origin with its fronts to -Y, the side wall turns along -Y
    // at its right-hand end, and the island stands 1200 mm in front of it. Every front faces the
    // default camera, which looks in from -X, -Y.
    private void RunScript(List<object> Keys, List<object> Sections, List<object> Fronts, List<object> Handles,
        ref object Carcass, ref object Panels, ref object Glass, ref object Pulls, ref object Worktop, ref object Floor)
    {
        var carcass = new List<Mesh>();
        var panels = new List<Mesh>();
        var glass = new List<Mesh>();
        var pulls = new List<Mesh>();
        var worktop = new List<Mesh>();
        var run = new Dictionary<string, double>();

        double backLength = 0;
        for (int i = 0; i < Keys.Count; i++)
        {
            if (Txt(At(Sections, i)) == "Back wall") backLength += Width;
        }

        for (int i = 0; i < Keys.Count; i++)
        {
            string key = Txt(Keys[i]), section = Txt(At(Sections, i)), front = Txt(At(Fronts, i)), handle = Txt(At(Handles, i));
            bool tall = key.Contains("larder");
            double u0 = run.TryGetValue(section, out var used) ? used : 0;
            run[section] = u0 + Width;

            var cabinet = new Cabinet(Wall(section, backLength), u0, Width, tall ? 2100 : 870);
            cabinet.Carcass(carcass, open: front == "Open shelves");
            if (!tall) worktop.Add(cabinet.Box(0, Width, -20, Depth, 870, 910));
            cabinet.Fronts(front, handle, panels, glass, pulls);
        }

        // The side wall leaves the corner between the two runs: a blind cabinet under the worktop.
        if (run.ContainsKey("Side wall"))
        {
            var corner = new Cabinet(Wall("Back wall", backLength), backLength, Depth, 870);
            corner.Carcass(carcass, open: false);
            worktop.Add(corner.Box(0, Depth, -20, Depth, 870, 910));
        }

        Carcass = carcass;
        Panels = panels;
        Glass = glass;
        Pulls = pulls;
        Worktop = worktop;
        Floor = new List<Mesh> { Mesh.CreateFromBox(new BoundingBox(-1500, -3200, -20, backLength + 2100, 1200, 0), 1, 1, 1) };
    }

    const double Width = 600, Depth = 600, Plinth = 120, Gap = 3, Board = 18;

    // Origin, run direction and the direction the fronts face.
    static (Point3d Origin, Vector3d Along, Vector3d Out) Wall(string section, double backLength)
    {
        switch (section)
        {
            case "Side wall": return (new Point3d(backLength, 0, 0), -Vector3d.YAxis, -Vector3d.XAxis);
            case "Island": return (new Point3d(Width, -1200 - Depth, 0), Vector3d.XAxis, -Vector3d.YAxis);
            default: return (Point3d.Origin, Vector3d.XAxis, -Vector3d.YAxis);
        }
    }

    sealed class Cabinet
    {
        readonly (Point3d Origin, Vector3d Along, Vector3d Out) wall;
        readonly double u0, width, height;

        public Cabinet((Point3d, Vector3d, Vector3d) wall, double u0, double width, double height)
        {
            this.wall = wall; this.u0 = u0; this.width = width; this.height = height;
        }

        // u along the run, v from the front (0) to the back (Depth), z up. Negative v is in front.
        public Mesh Box(double ua, double ub, double va, double vb, double za, double zb)
        {
            var a = wall.Origin + wall.Along * (u0 + ua) - wall.Out * va + Vector3d.ZAxis * za;
            var b = wall.Origin + wall.Along * (u0 + ub) - wall.Out * vb + Vector3d.ZAxis * zb;
            return Mesh.CreateFromBox(new BoundingBox(new[] { a, b }), 1, 1, 1);
        }

        public void Carcass(List<Mesh> into, bool open)
        {
            into.Add(Box(0, Board, 0, Depth, 0, height));
            into.Add(Box(width - Board, width, 0, Depth, 0, height));
            into.Add(Box(Board, width - Board, 20, Depth, 0, Plinth));
            into.Add(Box(Board, width - Board, 0, Depth, Plinth, Plinth + Board));
            into.Add(Box(Board, width - Board, 0, Depth, height - Board, height));
            into.Add(Box(Board, width - Board, Depth - 6, Depth, Plinth, height));
            if (!open) return;
            double step = (height - Plinth) / 3;
            for (int s = 1; s < 3; s++)
            {
                double z = Plinth + s * step;
                into.Add(Box(Board, width - Board, 0, Depth - 6, z, z + Board));
            }
        }

        public void Fronts(string front, string handle, List<Mesh> panels, List<Mesh> glass, List<Mesh> pulls)
        {
            if (front == "Open shelves") return;
            bool drawers = front.EndsWith("drawers");
            int count = drawers ? (height > 1000 ? 4 : 3) : (width > 700 ? 2 : 1);
            double z0 = Plinth + Gap, z1 = height - Gap;
            for (int i = 0; i < count; i++)
            {
                double ua = drawers ? Gap : i * width / count + Gap / 2, ub = drawers ? width - Gap : (i + 1) * width / count - Gap / 2;
                double za = drawers ? z0 + i * (z1 - z0) / count + Gap / 2 : z0, zb = drawers ? z0 + (i + 1) * (z1 - z0) / count - Gap / 2 : z1;
                if (front == "Glazed door")
                {
                    Frame(panels, ua, ub, za, zb, 60, -Board, 0);
                    glass.Add(Box(ua + 60, ub - 60, -Board / 2 - 2, -Board / 2 + 2, za + 60, zb - 60));
                }
                else
                {
                    panels.Add(Box(ua, ub, -Board, 0, za, zb));
                    if (front.StartsWith("Shaker")) Frame(panels, ua, ub, za, zb, 60, -Board - 6, -Board);
                }

                // A drawer's pull is centred at its top; a door's sits by the edge that opens.
                bool right = !drawers && (count == 1 || i == 0);
                double pu = drawers ? (ua + ub) / 2 : right ? ub - 50 : ua + 50;
                double pz = drawers ? zb - 60 : (height > 1000 ? 1050 : zb - 120);
                Pull(handle, pulls, pu, pz, ua, ub, zb, drawers);
            }
        }

        void Frame(List<Mesh> into, double ua, double ub, double za, double zb, double rail, double va, double vb)
        {
            into.Add(Box(ua, ub, va, vb, za, za + rail));
            into.Add(Box(ua, ub, va, vb, zb - rail, zb));
            into.Add(Box(ua, ua + rail, va, vb, za + rail, zb - rail));
            into.Add(Box(ub - rail, ub, va, vb, za + rail, zb - rail));
        }

        void Pull(string handle, List<Mesh> into, double u, double z, double ua, double ub, double zb, bool drawers)
        {
            const double front = -Board - 6;
            switch (handle)
            {
                case "Knob":
                    var at = wall.Origin + wall.Along * (u0 + u) - wall.Out * front + Vector3d.ZAxis * z;
                    var circle = new Circle(new Plane(at, wall.Out), 14);
                    into.Add(Mesh.CreateFromCylinder(new Cylinder(circle, 24), 1, 24, true, true));
                    break;
                case "Bar":
                    if (drawers) into.Add(Box(u - 80, u + 80, front - 24, front, z - 6, z + 6));
                    else into.Add(Box(u - 6, u + 6, front - 24, front, z - 80, z + 80));
                    break;
                case "Cup pull":
                    into.Add(Box(u - 45, u + 45, front - 18, front, z - 14, z + 6));
                    break;
                case "Edge pull":
                    into.Add(Box(ua + 20, ub - 20, front - 10, front, zb - 4, zb + 8));
                    break;
            }
        }
    }

    static object At(List<object> list, int i) => i < list.Count ? list[i] : null;
    static string Txt(object o) { return o == null ? "" : o.ToString().Trim('"'); }
}
