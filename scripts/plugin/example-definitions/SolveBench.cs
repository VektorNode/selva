using Grasshopper.Kernel;
using System.Collections.Generic;
using System.Drawing;
using static SelvaBuilder;
using static GhIn;

public static partial class Definitions
{
    // ============================================================================
    // Solve bench: what a re-solve costs, one input at a time
    // ============================================================================

    // Each input feeds one part of the graph, so a change to it shows exactly what re-runs and what
    // re-ships. The input names are the contract with scripts/develop/solve-bench: rename one there too.
    static List<(IGH_DocumentObject, object)> SolveBench(B b)
    {
        b.Note("SOLVE BENCH\nFor developers. Each input changes one part of the graph, so the solve bench can split a re-solve into " +
               "Grasshopper time, encoding, transport and the browser. See plans/research/solve-transport-bench.md.", w: 560);

        var nIn = b.Note("INPUTS\nUpstream work holds every solve that reaches it. Mesh size and Context size are megabytes on the " +
                         "wire, roughly. Shape moves only the first Shape scope panels.");
        var work = b.Number("Upstream work", 0, 0.5, 10, 1);
        var shape = b.Number("Shape", 0, 0.5, 1, 2);
        var size = b.Number("Mesh size", 1, 5, 60, 0);
        var branches = b.Number("Branches", 1, 4, 32, 0);
        var scope = b.Number("Shape scope", 1, 1, 32, 0);
        var context = b.Number("Context size", 0, 5, 50, 0);
        var colour = b.Colour("Colour", Color.FromArgb(58, 123, 213));
        var files = b.Switch("Files", false);
        b.Section("Inputs", nIn, work, shape, size, branches, scope, context, colour, files);

        var nWork = b.Note("UPSTREAM WORK\nA fixed wait every panel depends on. A warm document skips it when only something " +
                           "below changes; a cold one pays it. Source: SolveBench.Upstream.script.cs.");
        var upstream = Script(b, "Upstream work", "SolveBench.Upstream.script.cs", new (string, object)[] { ("Seconds", work) }, "Base");
        b.Section("Upstream work", nWork, upstream);

        var nPanels = b.Note("PANELS\nOne wavy panel per branch, each its own Display branch. Colour changes only the material. " +
                             "Faces is a result that ships almost nothing. Source: SolveBench.Panels.script.cs.");
        var panels = Script(b, "Panels", "SolveBench.Panels.script.cs",
            new (string, object)[]
            {
                ("Base", H.Out(upstream, "Base")), ("Shape", shape), ("MeshSize", size), ("Branches", branches), ("Scope", scope),
            },
            "Panels", "Faces");
        var finish = b.ThreeMaterial(Color: colour, Roughness: 0.5, nick: "Panel finish");
        var panelDisplay = b.Display(Geo: H.Out(panels, "Panels"), Name: "Panel", Layer: "Bench/Panels", Material: finish.Material, nick: "Panel display");
        var oPanels = b.Output("Panels", panelDisplay.Obj);
        var pFaces = b.Print("Faces", panels, "Faces");
        b.Section("Panels", nPanels, panels, finish.Obj, panelDisplay.Obj, oPanels, pFaces);

        var nContext = b.Note("CONTEXT\nA ground slab that reads only its own size, so it ships byte-identical on every other change. " +
                              "Source: SolveBench.Context.script.cs.");
        var slab = Script(b, "Context", "SolveBench.Context.script.cs", new (string, object)[] { ("Size", context) }, "Context");
        var ground = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(150, 150, 145)), Roughness: 0.9, nick: "Ground");
        var contextDisplay = b.Display(Geo: H.Out(slab, "Context"), Name: "Ground", Layer: "Bench/Context", Material: ground.Material, nick: "Context display");
        var oContext = b.Output("Context", contextDisplay.Obj);
        b.Section("Context", nContext, slab, ground.Obj, contextDisplay.Obj, oContext);

        var nFiles = b.Note("FILES\nA 3DM of the panels on every solve while Files is on; off, a 3DM of one point, so the output " +
                            "never goes empty.");
        var placeholder = b.Pt("Placeholder", 0.0, 0.0, 0.0);
        var picked = b.StreamFilter(Gate: files, Stream0: placeholder, Stream1: Flatten(H.Out(panels, "Panels")), nick: "Model geometry");
        var model = b.GeometryToFile(Geometry: picked.Stream, LayerNames: "Panels", FileNames: "solve-bench", FileEnding: ".3dm", nick: "Model");
        var oModel = b.Output("Model (3DM)", model.Obj);
        b.Section("Files", nFiles, placeholder, picked.Obj, model.Obj, oModel);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(SolveBenchForm());
        return new()
        {
            (upstream, "Base"), (panels, "Panels"), (panels, "Faces"), (panelDisplay.Obj, null),
            (slab, "Context"), (contextDisplay.Obj, null), (model.Obj, null),
        };
    }

    static string SolveBenchForm() => Json(@"{
  'name': 'Solve Bench',
  'description': 'For developers: one input per cost, so a re-solve can be split into Grasshopper, encoding, transport and the browser.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'look': 'technical' },
  'tabs': [
    { 'label': 'Bench', 'groups': [
      { 'label': 'Cost', 'items': [
        { 'param': 'Upstream work', 'label': 'Upstream work (s)', 'description': 'Waits this long whenever a solve reaches it.', " + SliderConfig + @" }
      ] },
      { 'label': 'Panels', 'items': [
        { 'param': 'Shape', " + SliderConfig + @" },
        { 'param': 'Mesh size', 'label': 'Mesh size (MB)', 'description': 'Roughly the panels on the wire.', " + SliderConfig + @" },
        { 'param': 'Branches', 'description': 'Display branches the panels split into.', " + SliderConfig + @" },
        { 'param': 'Shape scope', 'description': 'How many panels a Shape change touches.', " + SliderConfig + @" },
        'Colour'
      ] },
      { 'label': 'Context', 'items': [
        { 'param': 'Context size', 'label': 'Context size (MB)', 'description': 'A slab no other input changes.', " + SliderConfig + @" }
      ] },
      { 'label': 'Files', 'items': [ 'Files' ] }
    ] },
    { 'label': 'Results', 'groups': [
      { 'label': 'Counts', 'items': [ 'Faces' ] },
      { 'label': 'Files', 'items': [ 'Model (3DM)' ] }
    ] }
  ]
}");
}
