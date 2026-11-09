// Grasshopper Script Instance
using System;

using Rhino.Geometry;

using Grasshopper.Kernel;

public class Script_Instance : GH_ScriptInstance
{
    // Keep equal to the panels script's constant: both convert megabytes on the wire to faces.
    const double WireBytesPerFace = 2.9;

    // A ground slab in front of the panels that reads no input but its own size, so it reaches the
    // browser byte-identical on every solve: the case a whole-item dedupe would skip. Size 0 still
    // gives one quad, because an empty Display warns on every solve.
    private void RunScript(object Size, ref object Context)
    {
        double megabytes = 0;
        GH_Convert.ToDouble(Size, out megabytes, GH_Conversion.Both);
        var side = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(Math.Max(0, megabytes) * 1e6 / WireBytesPerFace)));

        var mesh = new Mesh();
        var rng = new Random(7);
        for (var v = 0; v <= side; v++)
            for (var u = 0; u <= side; u++)
            {
                double x = (double)u / side, y = (double)v / side;
                mesh.Vertices.Add(-0.5 + x * 12, -2.5 + y * 2, -0.3 + (rng.NextDouble() - 0.5) * 0.01);
            }
        for (var v = 0; v < side; v++)
            for (var u = 0; u < side; u++)
            {
                var a = v * (side + 1) + u;
                mesh.Faces.AddFace(a, a + 1, a + side + 2, a + side + 1);
            }
        mesh.Normals.ComputeNormals();
        Context = mesh;
    }
}
