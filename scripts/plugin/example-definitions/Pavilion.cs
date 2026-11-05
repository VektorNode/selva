using Grasshopper.Kernel;
using System.Collections.Generic;
using System.Drawing;
using static SelvaBuilder;
using System.Linq;
using static GhIn;

public static partial class Definitions
{
    // ============================================================================
    // Timber lamella pavilion
    // ============================================================================

    static List<(IGH_DocumentObject, object)> Pavilion(B b)
    {
        b.Note("TIMBER LAMELLA PAVILION\nA timber lamella shell over a town square. Choose a form, size the shell and its lamellas, " +
               "then download the drawing set, the cut list and the model. Every step is a stock or Selva component.", w: 560);

        // ---- Inputs
        var nShape = b.Note("SHAPE\nPillow stands on four corners with an arched opening on every side. Vault and Wave spring from the long edges.");
        var form = b.Choice("Form", 0, "Pillow", "Vault", "Wave");
        var span = b.Number("Span", 10, 18, 30, 1);
        var depth = b.Number("Depth", 8, 13, 24, 1);
        var height = b.Number("Height", 3, 5.5, 9, 1);
        var openings = b.Number("Openings", 0, 0.55, 0.85, 2);
        var waves = b.Number("Waves", 1, 2, 4, 0);
        b.Section("Shape", nShape);

        var nStruct = b.Note("STRUCTURE\nTwo sets of glulam lamellas cut from the shell on vertical planes at 45°. Sizes in centimetres.");
        var spacing = b.Number("Lamella spacing", 0.5, 0.9, 1.6, 2);
        var depthCm = b.Number("Lamella depth", 12, 24, 40, 0);
        var widthCm = b.Number("Lamella width", 6, 10, 16, 0);
        var timber = b.Choice("Timber", 0, "Larch", "Walnut", "Charred");
        var beamColour = b.Colour("Edge beam colour", Color.FromArgb(52, 58, 62));
        b.Section("Structure", nStruct);

        var nSite = b.Note("SITE\nPaving for the square, an optional glass roof, and pendant lamps that light up in the viewer's Night look.");
        var paving = b.Choice("Paving", 0, "Concrete", "Brick", "Limestone");
        var glass = b.Switch("Glass roof", false);
        var lights = b.Switch("Evening lights", true);
        b.Section("Site", nSite);

        // ---- Shell surface: one arch across the depth per station along the span, lofted
        var nRoof = b.Note("SHELL\nThe height at (u, v) is the chosen form's function times the height. Pillow blends a dome (both arches) " +
                           "with the edge arches by Openings.");
        var u = b.Range(Steps: 32, nick: "u");
        var v = b.Range(Steps: 24, nick: "v");
        var xs = b.Ev("(x-0.5)*y", "x along span", u, span);
        var ys = b.Ev("(x-0.5)*y", "y across depth", v, depth);
        var dome = b.Ev("sin(pi*x)*sin(pi*y)", "Dome", Graft(u), v);
        var edgeArches = b.Ev("sin(pi*x)+sin(pi*y)-2*sin(pi*x)*sin(pi*y)", "Edge arches", Graft(u), v);
        var lift = b.Multiplication(edgeArches, openings, nick: "Opening lift");
        var pillow = b.Addition(dome, lift, nick: "Pillow");
        var vault = b.Ev("sin(pi*y)+0*x", "Vault", Graft(u), v);
        var crests = b.Multiplication(u, waves, nick: "Crests");
        var wave = b.Ev("sin(pi*y)*(0.72+0.28*cos(2*pi*x))", "Wave", Graft(crests), v);
        var formIdx = b.IndexOf(form, "Form index", "Pillow", "Vault", "Wave");
        var pick = b.StreamFilter(Gate: formIdx, Stream0: pillow, Stream1: vault, inputs: 4, nick: "Chosen form");
        b.Feed(pick.Obj, 3, wave);
        var z = b.Multiplication(pick, height, nick: "z");
        var pts = b.ConstructPoint(XCoordinate: Graft(xs), YCoordinate: ys, ZCoordinate: z, nick: "Shell points");
        var arches = b.Interpolate(Vertices: pts, nick: "Arches");
        var loft = b.Loft(Curves: Flatten(arches.Curve), nick: "Shell");
        var shell = b.Add("c8b23e4e-8093-406c-b859-3eba38a2bcd6", nick: "Shaping the shell");
        b.Feed(shell, 0, loft); b.Set(shell, "M", "Shaping the shell…");
        b.Section("Shell", nRoof);

        // ---- Lamellas: contours at ±45°, each stood up as a board below the shell
        var nLam = b.Note("LAMELLAS\nContours on vertical planes at ±45°. Each is extruded down by the lamella depth, then sideways by its width. " +
                          "Offcuts shorter than 60 cm are dropped.");
        var d = b.Ev("x/100", "Depth (m)", depthCm);
        var w = b.Ev("x/100", "Width (m)", widthCm);
        var down = b.UnitZ(Factor: b.Negative(d), nick: "Down");
        var cutting = b.Add("c8b23e4e-8093-406c-b859-3eba38a2bcd6", nick: "Cutting lamellas");
        b.Set(cutting, "M", "Cutting lamellas…");
        b.Feed(cutting, 0, shell);
        b.Section("Lamellas", nLam);

        LamellaSet Family(string name, double dy)
        {
            var dir = b.VectorXYZ(XComponent: 1.0, YComponent: dy, ZComponent: 0.0, nick: "Set " + name + " direction");
            var cont = b.Contour(Shape: cutting, Direction: dir, Distance: spacing, nick: "Set " + name);
            var flat = b.FlattenTree(Tree: cont.Contours, nick: "Set " + name + " list");
            var len = b.Length(Curve: flat, nick: "Set " + name + " lengths");
            var keep = b.Dispatch(List: flat, DispatchPattern: b.LargerThan(FirstNumber: len, SecondNumber: 0.6), nick: "Set " + name + " trimmed");
            var ribbon = b.Extrude(Base: keep.ListA, Direction: down, nick: "Set " + name + " ribbons");
            var side = b.Amplitude(Vector: dir, Amplitude: w, nick: "Set " + name + " width");
            var board = b.Extrude(Base: ribbon, Direction: side, nick: "Set " + name + " boards");
            var keptLen = b.Length(Curve: keep.ListA, nick: "Set " + name + " cut lengths");
            b.Section("Lamella set " + name, b.Note($"SET {name}\nLamellas running {(dy > 0 ? "south-west to north-east" : "north-west to south-east")}."));
            return new LamellaSet(name, keep.ListA, board, keptLen);
        }
        var a = Family("A", 1);
        var bb = Family("B", -1);
        var nAll = b.Note("BOTH SETS\nBoards for the 3D view and the model; centre lines and lengths for the drawings, quantities and cut list.");
        var boards = b.Merge(Data1: a.Boards, Data2: bb.Boards, nick: "All boards");
        var lamCurves = b.Merge(Data1: a.Curves, Data2: bb.Curves, nick: "All lamella lines");
        var lengths = b.Merge(Data1: a.Lengths, Data2: bb.Lengths, nick: "All lengths");
        b.Section("Both sets", nAll);

        // ---- Structure and site
        var nSiteGeo = b.Note("STRUCTURE AND SITE\nEdge beams on the shell's free edges, concrete footings at the corners, the square, " +
                              "two benches and six pendant lamps hung from the shell.");
        var edges = b.BrepEdges(Brep: shell, nick: "Free edges");
        var beamR = b.Ev("x*0.4", "Beam radius", d);
        var beams = b.Pipe(Curve: edges.Naked, Radius: beamR, Caps: 1, nick: "Edge beams");
        var hs = b.Ev("x/2", "Half span", span);
        var hd = b.Ev("x/2", "Half depth", depth);
        var cornerX = b.Merge(Data1: b.Negative(hs), Data2: hs, nick: "Corner x");
        var cornerY = b.Merge(Data1: b.Negative(hd), Data2: hd, nick: "Corner y");
        var corners = b.ConstructPoint(XCoordinate: cornerX, YCoordinate: Graft(cornerY), ZCoordinate: 0.0, nick: "Corners");
        var footings = b.Cylinder(Base: Flatten(corners), Radius: 0.35, Length: 0.45, nick: "Footings");
        var plazaX = b.Ev("x/2+2.5", "Square half length", span);
        var plazaY = b.Ev("x/2+2.5", "Square half width", depth);
        var plaza = b.CenterBox(Base: b.Pt("Square centre", 0.0, 0.0, -0.1), X: plazaX, Y: plazaY, Z: 0.1, nick: "Square");
        var benchHalf = b.Ev("x*0.17", "Bench half length", span);
        var benchY = b.Ev("x*0.2", "Bench offset", depth);
        var benchPts = b.ConstructPoint(XCoordinate: 0.0, YCoordinate: b.Merge(Data1: b.Negative(benchY), Data2: benchY), ZCoordinate: 0.0, nick: "Bench centres");
        var benchOutline = b.Rectangle(Plane: benchPts, XSize: b.ConstructDomain(DomainStart: b.Negative(benchHalf), DomainEnd: benchHalf),
            YSize: b.ConstructDomain(DomainStart: -0.25, DomainEnd: 0.25), nick: "Bench outlines");
        var benches = b.CapHoles(Brep: b.Extrude(Base: benchOutline.Rectangle, Direction: b.UnitZ(Factor: 0.45)), nick: "Benches");
        var lampFracX = b.Panel("-0.25\n0\n0.25", name: "Lamp stations along", h: 60);
        var lampFracY = b.Panel("-0.18\n0.18", name: "Lamp stations across", h: 40);
        var lampFloor = b.ConstructPoint(XCoordinate: b.Multiplication(lampFracX, span), YCoordinate: Graft(b.Multiplication(lampFracY, depth)), ZCoordinate: 0.0, nick: "Lamp floor points");
        var hang = b.ProjectPoint(Point: Flatten(lampFloor), Direction: b.UnitZ(), Geometry: shell, nick: "Hanging points");
        var drop = b.UnitZ(Factor: b.Ev("-(x+1.2)", "Cord drop", d), nick: "Cord");
        var lampPts = b.Move(Geometry: hang.Point, Motion: drop, nick: "Lamps");
        var bulbs = b.Sphere(Base: lampPts.Geometry, Radius: 0.17, nick: "Bulbs");
        var cordLines = b.Line(StartPoint: hang.Point, EndPoint: lampPts.Geometry, nick: "Cord lines");
        var cords = b.Pipe(Curve: cordLines, Radius: 0.01, nick: "Cords");
        var glassRoof = b.Move(Geometry: shell, Motion: b.UnitZ(Factor: 0.04), nick: "Glass roof");
        b.Section("Structure and site", nSiteGeo);

        // ---- Materials and the 3D view
        var nView = b.Note("3D VIEW\nOne Display per part, each on its own layer. The glass roof is always there: switched off it takes an invisible material. Glass keeps its reflections at any opacity, so an opacity of 0 would still show it.");
        var timberIdx = b.IndexOf(timber, "Timber index", "Larch", "Walnut", "Charred");
        var charred = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(38, 33, 30)), Roughness: 0.85, Base: b.Preset("Wood"), nick: "Charred");
        var woods = b.Merge(Data1: b.Preset("Wood", "Larch"), Data2: b.Preset("Walnut", "Walnut"), inputs: 3, nick: "Timbers");
        b.Feed(woods.Obj, 2, charred);
        var wood = b.ListItem(List: woods, Index: timberIdx, nick: "Timber");
        var steel = b.ThreeMaterial(Color: beamColour, Metalness: 0.6, Roughness: 0.35, nick: "Beam finish");
        var pavingIdx = b.IndexOf(paving, "Paving index", "Concrete", "Brick", "Limestone");
        var pavingMat = b.MaterialPreset(Preset: b.Lookup(pavingIdx, "I", "Paving preset", PresetText("Concrete"), PresetText("Brick"), PresetText("Plaster")), nick: "Paving");
        var concrete = b.Preset("Concrete", "Concrete");
        var invisible = b.ThreeMaterial(Opacity: 0.0, Transparent: true, nick: "Invisible");
        var glassChoices = b.Merge(Data1: invisible, Data2: b.Preset("Glass", "Glass preset"), nick: "Glass choices");
        var glassMat = b.ListItem(List: glassChoices, Index: b.Ev("if(x,1,0)", "Glass shown", glass), nick: "Glass");
        var lampMat = b.EmissiveMaterial(Color: b.Swatch(Color.FromArgb(255, 190, 120)), Strength: b.Ev("if(x,6,0)", "Lamp strength", lights), nick: "Lamp light");
        var cordMat = b.Preset("Coil-coated (RAL)", "Cord");
        var shows = new[]
        {
            b.Display(Geo: boards, Name: "Lamellas", Layer: "Shell/Lamellas", Material: wood, nick: "Lamellas"),
            b.Display(Geo: glassRoof, Name: "Glass roof", Layer: "Shell/Glass", Material: glassMat, nick: "Glass roof"),
            b.Display(Geo: Flatten(beams), Name: "Edge beams", Layer: "Structure/Edge beams", Material: steel, nick: "Edge beams"),
            b.Display(Geo: footings, Name: "Footings", Layer: "Structure/Footings", Material: concrete, nick: "Footings"),
            b.Display(Geo: plaza, Name: "Square", Layer: "Site/Square", Material: pavingMat, nick: "Square"),
            b.Display(Geo: benches, Name: "Benches", Layer: "Site/Benches", Material: wood, nick: "Benches"),
            b.Display(Geo: bulbs, Name: "Lamps", Layer: "Lighting/Lamps", Material: lampMat, nick: "Lamps"),
            b.Display(Geo: Flatten(cords), Name: "Cords", Layer: "Lighting/Cords", Material: cordMat, nick: "Cords"),
        };
        var combine = b.CombineDisplay(nick: "Pavilion");
        foreach (var s in shows) b.Feed(combine.Obj, 0, s);
        var oModel = b.Output("Pavilion", combine.Obj);
        b.Section("3D view", nView);

        // ---- Quantities, checks and the chart
        var nQ = b.Note("QUANTITIES AND CHECKS\nTimber volume, stored carbon (0.9 t CO₂e per m³ of timber) and a rough cost. " +
                        "Warns when the shell is shallow or a lamella is too long to transport.");
        var count = b.ListLength(List: lengths, nick: "Lamella count");
        var total = b.MassAddition(Input: lengths, nick: "Total length");
        var section = b.Multiplication(d, w, nick: "Section area");
        var volume = b.Multiplication(total.Result, section, nick: "Timber volume");
        var carbon = b.Ev("x*0.9", "Stored carbon", volume);
        var area = b.Area(Geometry: shell, nick: "Shell area");
        var cost = b.Ev("x*2400+y*140", "Cost estimate", volume, area.Area);
        var prints = new[]
        {
            b.Print("Shell area (m²)", b.Fmt("{0:0}", area.Area.Obj, area.Area.Index)),
            b.Print("Lamellas", count.Obj),
            b.Print("Lamella length (m)", b.Fmt("{0:0}", total.Obj)),
            b.Print("Timber volume (m³)", b.Fmt("{0:0.0}", volume.Obj)),
            b.Print("Stored carbon (t CO₂e)", b.Fmt("{0:0.0}", carbon.Obj)),
            b.Print("Cost estimate (EUR)", b.Fmt("{0:#,0}", cost.Obj)),
        };
        var sorted = b.SortList(Keys: lengths, nick: "Sorted lengths");
        var longest = b.ListItem(List: sorted.Keys, Index: -1, Wrap: true, nick: "Longest lamella");
        var pLongest = b.Print("Longest lamella (m)", b.Fmt("{0:0.00}", longest.Obj));
        var transportable = b.SmallerThan(FirstNumber: longest, SecondNumber: 24.0, nick: "Transportable?");
        var msgLong = b.Warning("Lamella too long", transportable.SmallerThan, "A lamella is longer than 24 m, past what a glulam truck carries: lower the span or plan a splice.");
        var deep = b.LargerThan(FirstNumber: b.Ev("x/y", "Rise over depth", height, depth), SecondNumber: 0.25, nick: "Deep enough?");
        var msgShallow = b.Warning("Shallow shell", deep.LargerThan, "Shallow shell: raise the height or reduce the depth, or the lamellas need a deeper section.");
        var hist = b.Histogram(X: lengths, Bins: 12, Color: b.Swatch(Color.FromArgb(166, 123, 80)), nick: "Length histogram");
        var figure = b.Figure(Traces: hist, Layout: b.Layout(Title: "Lamella lengths (m)"), nick: "Lengths chart");
        var oChart = b.Output("Lamella lengths", figure.Obj);
        b.Section("Quantities", nQ);

        var pdf = PavilionDrawings(b, new PavilionModel(shell, a, bb, edges.Naked, span, depth, height, hs, hd, d, lamCurves, corners, benchOutline.Rectangle,
            benchHalf, benchY, lampPts.Geometry, hang.Point, timber, spacing, depthCm, widthCm, count, total, beamR));

        // ---- Downloads: cut list and model
        var nFiles = b.Note("DOWNLOADS\nA cut list with one row per lamella, and the whole pavilion as a Rhino model.");
        var csvRows = b.Merge(Data1: CutRows(b, "A", a.Lengths, widthCm, depthCm), Data2: CutRows(b, "B", bb.Lengths, widthCm, depthCm), nick: "CSV rows");
        var csvLines = b.Merge(Data1: b.Panel("Lamella,Set,Length (m),Width (mm),Depth (mm)", name: "CSV header"), Data2: csvRows, nick: "CSV lines");
        var csv = b.CreateFile(Data: Flatten(csvLines), Name: "lamella-cut-list", Extension: ".csv", IsBase64: false, nick: "Cut list");
        var oCsv = b.Output("Cut list (CSV)", csv.Obj);
        var modelParts = b.Merge(Data1: boards, Data2: beams, inputs: 4, nick: "Model parts");
        b.Feed(modelParts.Obj, 2, footings); b.Feed(modelParts.Obj, 3, benches);
        var model = b.GeometryToFile(Geometry: Flatten(modelParts), LayerNames: "Pavilion", FileNames: "lamella-pavilion", FileEnding: ".3dm", nick: "Model");
        var o3dm = b.Output("Model (3DM)", model.Obj);
        b.Section("Downloads", nFiles);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(PavilionForm());
        return new() { (pick.Obj, null), (shell, null), (a.Curves.Obj, a.Curves.Index), (bb.Curves.Obj, bb.Curves.Index), (cutting, null), (beams.Obj, null),
            (hang.Obj, null), (bulbs.Obj, null), (combine.Obj, null), (cost.Obj, null), (longest.Obj, null), (figure.Obj, null), (pdf, null), (csv.Obj, null), (model.Obj, null) };
    }

    /// <summary>"A01,A,12.345,100,240" per lamella of one set.</summary>
    static IGH_DocumentObject CutRows(B b, string set, GhOut lengths, object widthCm, object depthCm)
    {
        var no = b.Series(Start: 1.0, Step: 1.0, Count: b.ListLength(List: lengths), nick: "Set " + set + " numbers");
        var row = b.Format(Format: set + "{0:00}," + set + ",{1:0.000},{2:0},{3:0}", Data0: no, Data1: lengths, inputs: 6, nick: "Set " + set + " rows");
        b.Feed(row.Obj, 4, b.Multiplication(widthCm, 10.0));
        b.Feed(row.Obj, 5, b.Multiplication(depthCm, 10.0));
        return row.Obj;
    }

    static string PavilionForm() => Json(@"{
  'name': 'Timber Lamella Pavilion',
  'description': 'A timber lamella shell over a town square. Choose a form, size the shell and its lamellas, then download the drawing set, the cut list and the model.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e9e5dd', 'look': 'showcase' },
  'assets': {
    'ic-pillow': { 'd': 'M3 19c1-6 3-9 9-9s8 3 9 9M3 19c3-3 6-4 9-4s6 1 9 4' },
    'ic-vault': { 'd': 'M3 19c0-8 4-13 9-13s9 5 9 13' },
    'ic-wave': { 'd': 'M3 19c0-7 3-11 6-11s3 4 3 4 0-4 3-4 6 4 6 11' },
    'th-larch': { 'img': 'LARCH' },
    'th-walnut': { 'img': 'WALNUT' },
    'th-charred': { 'img': 'CHARRED' },
    'th-concrete': { 'img': 'CONCRETE' },
    'th-brick': { 'img': 'BRICK' },
    'th-limestone': { 'img': 'LIMESTONE' }
  },
  'tabs': [
    { 'label': 'Shape', 'groups': [
      { 'label': 'Form', 'items': [
        { 'param': 'Form', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Pillow': { 'icon': 'ic-pillow' }, 'Vault': { 'icon': 'ic-vault' }, 'Wave': { 'icon': 'ic-wave' } } } },
        { 'param': 'Openings', 'description': 'How high the arches between the four corners rise, as a share of the height.', " + SliderConfig + ", " + ShowWhen("Form", "Pillow") + @" },
        { 'param': 'Waves', 'description': 'Crests along the span.', " + SliderConfig + ", " + ShowWhen("Form", "Wave") + @" }
      ] },
      { 'label': 'Size', 'items': [
        { 'param': 'Span', 'label': 'Span (m)', " + SliderConfig + @" },
        { 'param': 'Depth', 'label': 'Depth (m)', " + SliderConfig + @" },
        { 'param': 'Height', 'label': 'Height (m)', " + SliderConfig + @" }
      ] }
    ] },
    { 'label': 'Structure', 'groups': [
      { 'label': 'Lamellas', 'items': [
        { 'param': 'Lamella spacing', 'label': 'Spacing (m)', " + SliderConfig + @" },
        { 'param': 'Lamella depth', 'label': 'Depth (cm)', " + SliderConfig + @" },
        { 'param': 'Lamella width', 'label': 'Width (cm)', " + SliderConfig + @" }
      ] },
      { 'label': 'Finish', 'items': [
        { 'param': 'Timber', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Larch': { 'image': 'th-larch' }, 'Walnut': { 'image': 'th-walnut' }, 'Charred': { 'image': 'th-charred' } } } },
        'Edge beam colour'
      ] }
    ] },
    { 'label': 'Site', 'groups': [
      { 'label': 'Square', 'items': [
        { 'param': 'Paving', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Concrete': { 'image': 'th-concrete' }, 'Brick': { 'image': 'th-brick' }, 'Limestone': { 'image': 'th-limestone' } } } }
      ] },
      { 'label': 'Roof and light', 'items': [
        { 'param': 'Glass roof', 'description': 'A glass skin just above the lamellas.' },
        { 'param': 'Evening lights', 'description': 'Pendant lamps. Switch the viewer to Night to see them light the square.' }
      ] }
    ] },
    { 'label': 'Results', 'groups': [
      { 'label': 'Quantities', 'items': [ 'Shell area (m²)', 'Lamellas', 'Lamella length (m)', 'Longest lamella (m)', 'Timber volume (m³)', 'Stored carbon (t CO₂e)', 'Cost estimate (EUR)' ] },
      { 'label': 'Lamella lengths', 'items': [ 'Lamella lengths' ] },
      { 'label': 'Downloads', 'items': [ 'Drawings (PDF)', 'Cut list (CSV)', 'Model (3DM)' ] }
    ] }
  ]
}").Replace("LARCH", H.Stripes(Color.FromArgb(201, 160, 112), Color.FromArgb(181, 138, 92)))
       .Replace("WALNUT", H.Stripes(Color.FromArgb(107, 71, 46), Color.FromArgb(88, 56, 36)))
       .Replace("CHARRED", H.Stripes(Color.FromArgb(44, 39, 36), Color.FromArgb(28, 25, 23)))
       .Replace("CONCRETE", H.Thumb(Color.FromArgb(168, 168, 164)))
       .Replace("BRICK", H.Stripes(Color.FromArgb(156, 78, 58), Color.FromArgb(214, 200, 186), every: 8))
       .Replace("LIMESTONE", H.Thumb(Color.FromArgb(226, 218, 200)));
}
