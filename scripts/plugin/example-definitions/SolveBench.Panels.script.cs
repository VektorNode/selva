// Grasshopper Script Instance
using System;
using System.Collections.Generic;

using Rhino.Geometry;

using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;

public class Script_Instance : GH_ScriptInstance
{
    // Wire bytes per quad face: the length of the Display goo's ToComputeJson (SLVA, base64), which
    // measured 2.8 for these panels and 3.2 for the context slab. Re-measure when the display encoding
    // changes, or Mesh size stops meaning megabytes.
    const double WireBytesPerFace = 2.9;

    // One wavy panel per branch, so each lands in its own Display branch. Only the first Scope
    // panels read Shape; the rest keep a fixed phase and stay byte-identical when Shape moves.
    // The jitter is seeded per panel and vertex: a perfectly regular grid deflates to almost
    // nothing, which would make Mesh size meaningless.
    private void RunScript(object Base, object Shape, object MeshSize, object Branches, object Scope,
        ref object Panels, ref object Faces)
    {
        double baseScale = 1, shape = 0.5, megabytes = 5;
        int branches = 4, scope = 1;
        GH_Convert.ToDouble(Base, out baseScale, GH_Conversion.Both);
        GH_Convert.ToDouble(Shape, out shape, GH_Conversion.Both);
        GH_Convert.ToDouble(MeshSize, out megabytes, GH_Conversion.Both);
        GH_Convert.ToInt32(Branches, out branches, GH_Conversion.Both);
        GH_Convert.ToInt32(Scope, out scope, GH_Conversion.Both);
        branches = Math.Max(1, branches);

        var facesPerPanel = megabytes * 1e6 / WireBytesPerFace / branches;
        var side = Math.Max(2, (int)Math.Ceiling(Math.Sqrt(facesPerPanel)));

        var tree = new DataTree<Mesh>();
        long faces = 0;
        for (var i = 0; i < branches; i++)
        {
            var phase = i < scope ? shape : 0.5;
            var mesh = Panel(i, side, phase, baseScale);
            faces += mesh.Faces.Count;
            tree.Add(mesh, new GH_Path(i));
        }
        Panels = tree;
        Faces = faces;
    }

    static Mesh Panel(int index, int side, double phase, double scale)
    {
        var mesh = new Mesh();
        var rng = new Random(1000 + index);
        for (var v = 0; v <= side; v++)
            for (var u = 0; u <= side; u++)
            {
                double x = (double)u / side, y = (double)v / side;
                var z = 0.12 * Math.Sin(2 * Math.PI * (2 * x + phase)) * Math.Cos(3 * Math.PI * y)
                    + (rng.NextDouble() - 0.5) * 0.004;
                mesh.Vertices.Add((index * 1.2 + x) * scale, y * scale, z * scale);
            }
        for (var v = 0; v < side; v++)
            for (var u = 0; u < side; u++)
            {
                var a = v * (side + 1) + u;
                mesh.Faces.AddFace(a, a + 1, a + side + 2, a + side + 1);
            }
        mesh.Normals.ComputeNormals();
        return mesh;
    }
}
