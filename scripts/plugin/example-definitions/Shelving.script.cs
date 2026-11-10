// Grasshopper Script Instance
using System;
using System.Collections.Generic;

using Rhino.Geometry;

using Grasshopper.Kernel;

public class Script_Instance : GH_ScriptInstance
{
    // A shelving unit in millimetres, standing on the floor at the origin with its front along -Y.
    // Bays, Shelves and Doors arrive resolved by their Get Dynamic Value Lists, so they always fit.
    private void RunScript(object Width, object Height, object Depth, object Bays, object Shelves, object Doors,
        ref object Carcass, ref object Fronts, ref object Knobs, ref object Floor, ref object Summary)
    {
        const double board = 18, plinth = 60, back = 6, gap = 3;
        double w = Num(Width, 1500), h = Num(Height, 1800), d = Num(Depth, 350);
        int bays = Math.Max(1, (int)Math.Round(Num(Bays, 3)));
        int shelves = Math.Max(0, (int)Math.Round(Num(Shelves, 4)));
        string doors = Txt(Doors, "None");
        double bay = w / bays;

        var carcass = new List<Mesh>();
        for (int i = 0; i <= bays; i++)
        {
            double x = Math.Min(Math.Max(i * bay - board / 2, 0), w - board);
            carcass.Add(Box(x, x + board, 0, d, 0, h));
        }
        carcass.Add(Box(board, w - board, 20, d, 0, plinth));
        carcass.Add(Box(board, w - board, 0, d, plinth, plinth + board));
        carcass.Add(Box(board, w - board, 0, d, h - board, h));
        carcass.Add(Box(board, w - board, d - back, d, plinth + board, h - board));

        // Shelves sit evenly between the bottom and the top: the spacing the Shelves options name.
        double clear = h - plinth - 2 * board, step = clear / (shelves + 1);
        for (int i = 0; i < bays; i++)
        {
            double x0 = i * bay + board / 2, x1 = (i + 1) * bay - board / 2;
            for (int s = 1; s <= shelves; s++)
            {
                double z = plinth + board + s * step - board / 2;
                carcass.Add(Box(x0, x1, 0, d - back, z, z + board));
            }
        }

        var fronts = new List<Mesh>();
        var knobs = new List<Mesh>();
        for (int i = 0; i < bays; i++)
        {
            if (!HasDoor(doors, i, bays)) continue;
            double x0 = i * bay + gap / 2, x1 = (i + 1) * bay - gap / 2;
            fronts.Add(Box(x0, x1, -board, 0, plinth + gap, h - gap));
            // The knob sits on the side away from the hinge: outer bays open outwards.
            double kx = i < bays / 2.0 ? x1 - 40 : x0 + 40;
            knobs.Add(Knob(new Point3d(kx, -board, plinth + clear / 2)));
        }

        Carcass = carcass;
        Fronts = fronts;
        Knobs = knobs;
        Floor = new List<Mesh> { Box(-900, w + 900, -1400, d + 200, -20, 0) };
        Summary = string.Format("{0} × {1:0} mm bays, {2} {3} each, doors: {4}", bays, bay, shelves,
            shelves == 1 ? "shelf" : "shelves", doors.ToLowerInvariant());
    }

    static bool HasDoor(string pattern, int i, int bays)
    {
        switch (pattern)
        {
            case "All bays": return true;
            case "Left bay": return i == 0;
            case "Alternate bays": return i % 2 == 0;
            case "Outer bays": return i == 0 || i == bays - 1;
            default: return false;
        }
    }

    static Mesh Box(double x0, double x1, double y0, double y1, double z0, double z1) =>
        Mesh.CreateFromBox(new BoundingBox(x0, y0, z0, x1, y1, z1), 1, 1, 1);

    static Mesh Knob(Point3d at)
    {
        var circle = new Circle(new Plane(at, -Vector3d.YAxis), 12);
        return Mesh.CreateFromCylinder(new Cylinder(circle, 22), 1, 24, true, true);
    }

    static string Txt(object o, string fallback) { return o == null || o.ToString().Trim('"') == "" ? fallback : o.ToString().Trim('"'); }
    static double Num(object o, double fallback) { double v; return o != null && GH_Convert.ToDouble(o, out v, GH_Conversion.Both) ? v : fallback; }
}
