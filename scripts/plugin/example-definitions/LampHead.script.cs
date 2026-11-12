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
    // The shade's profile and the light sources that fit it. It runs before the Light source input, so the
    // list offered and the pick made from it belong to one solve. Profile is the shade's half section:
    // x the radius, z the depth along the light direction.
    private void RunScript(object Head, object HeadSize, object BarLength, object Diffuser,
		ref object Options, ref object Sources, ref object Profile)
    {
        string head = Txt(Head, "Dome");
        double R = Num(HeadSize, 170) / 2, barLen = Num(BarLength, 420);
        bool diffuser = Bool(Diffuser, true), bar = head == "Linear Bar";

        var profile = bar ? new List<Point3d> { new Point3d(23, 0, 0), new Point3d(23, 0, 28) } : HeadProfile(head, R);
        double depth = profile[profile.Count - 1].Z, mouth = profile[profile.Count - 1].X;

        // Behind a diffuser a bulb must sit inside the shade; without one it may stand proud of the rim,
        // like an exposed filament globe.
        var fits = new List<Lamp>();
        if (bar)
            fits.AddRange(Strips.Select(s => new Lamp(s.Id, s.Name, s.Lm * barLen / 1000, s.W * barLen / 1000, s.Price * barLen / 1000, 0, 0, "strip") { Label = Label(s) }));
        else
        {
            double room = 2 * mouth * (head == "Cylinder" ? 0.95 : 0.8);
            double reachOut = depth + (diffuser ? -4 : 30);
            fits.AddRange(Bulbs.Where(b => b.Dia + 10 <= room && Tip(b, profile) <= reachOut));
            if (fits.Count == 0) fits.Add(Bulbs[Bulbs.Length - 1]);
        }
        fits = fits.OrderByDescending(o => o.Lm).ToList();

        // The label is the option's name in the form, so it must not change with the bar's length.
        Options = fits.Select(o => string.Format(Inv, "\"{0}\" = {1}", o.Label ?? Label(o), o.Id)).ToList();
        Sources = fits.Select(o => string.Format(Inv, "{0}|{1}|{2:0.#}|{3:0.##}|{4:0.##}|{5}|{6}|{7}|{8:0.#}|{9:0.#}",
            o.Id, o.Name, o.Lm, o.W, o.Price, o.Dia, o.Len, o.Kind, Seat(o, profile), Tip(o, profile))).ToList();
        Profile = profile;
    }

    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // A light source: lumens, watts and price, and for bulbs the diameter and length the head must hold.
    class Lamp
    {
        public string Id, Name, Kind, Label; public double Lm, W, Price, Dia, Len;
        public Lamp(string id, string name, double lm, double w, double price, double dia, double len, string kind)
        { Id = id; Name = name; Lm = lm; W = w; Price = price; Dia = dia; Len = len; Kind = kind; }
    }

    static readonly Lamp[] Bulbs =
    {
        new Lamp("globe-6", "Filament globe 6 W", 470, 6, 14, 95, 135, "globe"),
        new Lamp("e27-13", "E27 LED 13 W", 1521, 13, 9, 67, 120, "bulb"),
        new Lamp("e27-9", "E27 LED 9 W", 806, 9, 6, 60, 105, "bulb"),
        new Lamp("gu10-7", "GU10 LED 7 W", 600, 7, 7, 50, 55, "spot"),
        new Lamp("module-6", "LED module 6 W", 600, 6, 11, 40, 18, "module"),
    };

    static string Label(Lamp s) { return string.Format(Inv, s.Kind == "strip" ? "{0}, {1:#,0} lm/m" : "{0}, {1:#,0} lm", s.Name, s.Lm); }

    // Per metre of bar.
    static readonly Lamp[] Strips =
    {
        new Lamp("strip-high", "High-output strip", 1600, 15, 26, 0, 0, "strip"),
        new Lamp("strip-std", "LED strip", 900, 9, 18, 0, 0, "strip"),
    };

    // Where a source starts along the head's axis. A bulb's narrow E27 neck sits in the collar; a spot or
    // module is as wide as its face, so it moves down the shade until the shade is wider than it.
    static double Seat(Lamp s, List<Point3d> profile)
    {
        if (s.Kind != "spot" && s.Kind != "module") return 0;
        for (double z = 0; z < profile[profile.Count - 1].Z; z += 1)
            if (HalfWidth(profile, z) >= s.Dia / 2 + 2) return z;
        return profile[profile.Count - 1].Z;
    }

    // Where a source's front ends.
    static double Tip(Lamp s, List<Point3d> profile)
    {
        if (s.Kind == "strip") return profile[profile.Count - 1].Z;
        return s.Kind == "module" ? Seat(s, profile) + 5 : Seat(s, profile) + s.Len - 12;
    }

    // The shade's inside radius at a depth along its axis.
    static double HalfWidth(List<Point3d> profile, double z)
    {
        double best = 0;
        for (int i = 1; i < profile.Count; i++)
        {
            Point3d a = profile[i - 1], b = profile[i];
            if (b.Z <= a.Z || z > b.Z || z < a.Z) continue;
            best = Math.Max(best, a.X + (b.X - a.X) * (z - a.Z) / (b.Z - a.Z));
        }
        return best;
    }

    static List<Point3d> HeadProfile(string head, double R)
    {
        var p = new List<Point3d>();
        if (head == "Cone")
        {
            p.Add(new Point3d(R * 0.14, 0, 0)); p.Add(new Point3d(R, 0, R * 0.92));
            return p;
        }
        if (head == "Cylinder")
        {
            double r = R * 0.62, d = R * 1.5;
            p.Add(new Point3d(0.01, 0, 0)); p.Add(new Point3d(r, 0, 0)); p.Add(new Point3d(r, 0, d));
            return p;
        }
        double depth = R * 0.74;
        p.Add(new Point3d(0.01, 0, 0));
        for (int i = 1; i <= 8; i++)
        {
            double t = i / 8.0 * Math.PI / 2;
            p.Add(new Point3d(R * Math.Sin(t), 0, depth * (1 - Math.Cos(t))));
        }
        return p;
    }

    static string Txt(object o, string fallback) { return o == null || o.ToString().Trim('"') == "" ? fallback : o.ToString().Trim('"'); }
    static double Num(object o, double fallback) { double v; return o != null && GH_Convert.ToDouble(o, out v, GH_Conversion.Both) ? v : fallback; }
    static bool Bool(object o, bool fallback) { bool v; return o != null && GH_Convert.ToBoolean(o, out v, GH_Conversion.Both) ? v : fallback; }
}
