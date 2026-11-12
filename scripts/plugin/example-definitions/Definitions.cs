using Grasshopper.Kernel;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;

/// <summary>
///     One method per .gh file. Each returns the outputs worth probing after the solve, so a dry
///     run shows that data actually flows. Rhino calls Run through the loader snippet.
/// </summary>
public static partial class Definitions
{
    /// <summary>The repo root; each file saves at its path below it.</summary>
    public static string Dir = "";

    /// <summary>When set, a dry run writes each definition's downloads (PDF, CSV…) to a folder here.</summary>
    public static string Files = "";

    static IEnumerable<(string Name, Func<B, List<(IGH_DocumentObject, object)>> Build)> All()
    {
        yield return ("examples/definitions/timber-gridshell-pavilion", Pavilion);
        yield return ("examples/definitions/perforated-facade", Facade);
        yield return ("examples/definitions/studio-task-lamp", Lamp);
        yield return ("examples/definitions/shelving-unit", Shelving);
        yield return ("examples/definitions/kitchen-run", Kitchen);
        yield return ("examples/definitions/dependent-forms-tutorial", Tutorial);
        yield return ("dev/grasshopper/stress-display-throughput", StressDisplay);
        yield return ("dev/grasshopper/stress-every-input-and-output", KitchenSink);
        yield return ("dev/grasshopper/bench-solve-transport", SolveBench);
    }

    /// <param name="which">File-name prefix to build, or "*" for all.</param>
    /// <param name="save">False for a dry run: build and solve, write nothing.</param>
    public static string Run(string which, bool save)
    {
        var log = new StringBuilder();
        foreach (var (name, build) in All())
        {
            if (which != "*" && !System.IO.Path.GetFileName(name).StartsWith(which)) continue;
            var b = new B();
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var probes = build(b);
                log.AppendLine("== " + name);
                log.Append(b.Solve());
                log.AppendLine($"  solved in {sw.ElapsedMilliseconds} ms, {b.Doc.ObjectCount} objects; slowest: " +
                    string.Join(", ", b.Doc.Objects.OfType<IGH_ActiveObject>().OrderByDescending(o => o.ProcessorTime)
                        .Take(5).Select(o => $"{o.NickName} {o.ProcessorTime.TotalMilliseconds:0} ms")));
                if (b.AfterSolve != null) log.AppendLine("  after solve: " + b.AfterSolve());
                foreach (var (o, key) in probes) log.AppendLine("  " + b.Data(o, key));
                if (Files != "") log.AppendLine("  files: " + b.DumpFiles(System.IO.Path.Combine(Files, System.IO.Path.GetFileName(name))));
                if (save)
                {
                    var path = System.IO.Path.Combine(Dir, name + ".gh");
                    b.Save(path);
                    log.AppendLine("  verify: " + B.Verify(path));
                }
                else b.Close();
            }
            catch (Exception e)
            {
                log.AppendLine("!! " + name + ": " + e);
                b.Close();
            }
        }
        return log.ToString();
    }
}
