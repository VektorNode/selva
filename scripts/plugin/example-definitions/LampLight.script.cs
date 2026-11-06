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
    // Illuminance along the desk under the lamp, in millimetres from the base. The shade throws
    // I0·cos^Spread(θ) inside its cut-off cone; I0 makes the light inside the cone add up to Lumens × Efficiency.
    private void RunScript(object Beam, object Lumens, object Spread, object Cutoff, object Efficiency, List<object> Desk,
		ref object LuxX, ref object LuxY, ref object Peak, ref object LitWidth, ref object TaskLight, ref object BrightEnough)
    {
        var beam = Plane.WorldXY;
        GH_Convert.ToPlane(Beam, ref beam, GH_Conversion.Both);
        double lumens = Num(Lumens, 0), n = Num(Spread, 1.5), cutoff = Num(Cutoff, 60) * Math.PI / 180;
        double i0 = Num(Efficiency, 0.8) * lumens * (n + 1) / (2 * Math.PI * (1 - Math.Pow(Math.Cos(cutoff), n + 1)));

        var desk = BoundingBox.Empty;
        foreach (var o in Desk)
        {
            var m = o as Mesh ?? (o as GH_Mesh)?.Value;
            if (m != null) desk.Union(m.GetBoundingBox(true));
        }

        var xs = new List<double>(); var lux = new List<double>();
        double peak = 0, lit = 0, step = (desk.Max.X - desk.Min.X) / 120;
        for (double px = desk.Min.X; px <= desk.Max.X + 0.01; px += step)
        {
            var toDesk = new Point3d(px, 0, desk.Max.Z) - beam.Origin;
            double d = toDesk.Length / 1000, theta = Vector3d.VectorAngle(beam.ZAxis, toDesk);
            double e = beam.Origin.Z > desk.Max.Z && theta <= cutoff
                ? i0 * Math.Pow(Math.Cos(theta), n) * (-toDesk.Z / toDesk.Length) / (d * d) : 0;
            xs.Add(Math.Round(px)); lux.Add(Math.Round(e));
            peak = Math.Max(peak, e);
            if (e >= 500) lit += step;
        }

        LuxX = xs; LuxY = lux;
        Peak = Math.Round(peak);
        LitWidth = Math.Round(lit);
        TaskLight = lumens == 0 ? "Light off"
            : peak >= 500 ? string.Format(CultureInfo.InvariantCulture, "Meets the 500 lx task target over {0:0} mm of desk", lit)
            : string.Format(CultureInfo.InvariantCulture, "Below the 500 lx task target: {0:0} lx at best", peak);
        BrightEnough = lumens == 0 || peak >= 500;
    }

    static double Num(object o, double fallback) { double v; return o != null && GH_Convert.ToDouble(o, out v, GH_Conversion.Both) ? v : fallback; }
}
