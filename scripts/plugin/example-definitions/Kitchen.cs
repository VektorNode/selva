using Grasshopper.Kernel;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using static GhIn;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Kitchen run: Options Table and Repeat
    // ============================================================================

    const string OptionsTable = "116a5e1c-7275-43c6-aab4-ad4680c56d7e";
    const string Repeat = "3b8f5d21-7c6a-4e19-a2d4-8e0b1c9f6a57";

    static readonly string[] KitchenLayouts = { "Straight", "L-shaped", "Island" };
    static readonly string[] KitchenStyles = { "Shaker", "Slab", "Handleless" };
    static readonly string[] KitchenMetals = { "Brass", "Steel", "Black" };

    // Key, label, section, and the layouts (by first letter) that have the cabinet. The L's corner is
    // a blind cabinet the script adds; it has no front to pick.
    static readonly (string Key, string Label, string Section, string Layouts)[] Cabinets =
    {
        ("back/sink", "Sink", "Back wall", "SLI"),
        ("back/prep", "Prep", "Back wall", "SLI"),
        ("back/hob", "Hob", "Back wall", "SLI"),
        ("back/larder", "Larder", "Back wall", "SI"),
        ("side/crockery", "Crockery", "Side wall", "L"),
        ("side/pans", "Pans", "Side wall", "L"),
        ("side/larder", "Larder", "Side wall", "L"),
        ("island/cutlery", "Cutlery", "Island", "I"),
        ("island/pans", "Pans", "Island", "I"),
        ("island/end", "Open end", "Island", "I")
    };

    // The picks the file opens with, by cabinet key. A style that doesn't offer one takes its first option.
    static readonly (string Key, string Front, string Handle)[] KitchenDefaults =
    {
        ("back/sink", "Shaker door", "Knob"), ("back/prep", "Shaker drawers", "Cup pull"), ("back/hob", "Shaker drawers", "Cup pull"),
        ("back/larder", "Shaker door", "Knob"), ("side/crockery", "Glazed door", "Knob"), ("side/pans", "Shaker drawers", "Cup pull"),
        ("side/larder", "Shaker door", "Knob"), ("island/cutlery", "Shaker drawers", "Cup pull"), ("island/pans", "Shaker door", "Knob"),
        ("island/end", "Open shelves", "None")
    };

    // Every style, front and handle that go together.
    static readonly (string Style, string Front, string[] Handles)[] KitchenOptions =
    {
        ("Shaker", "Shaker door", new[] { "Knob", "Bar", "Edge pull" }),
        ("Shaker", "Shaker drawers", new[] { "Cup pull", "Knob", "Bar" }),
        ("Shaker", "Glazed door", new[] { "Knob", "Bar", "Edge pull" }),
        ("Shaker", "Open shelves", new[] { "None" }),
        ("Slab", "Slab door", new[] { "Bar", "Knob", "Edge pull" }),
        ("Slab", "Slab drawers", new[] { "Bar", "Knob", "Edge pull" }),
        ("Slab", "Open shelves", new[] { "None" }),
        ("Handleless", "Push door", new[] { "None" }),
        ("Handleless", "Push drawers", new[] { "None" }),
        ("Handleless", "Open shelves", new[] { "None" })
    };

    static readonly (string Name, Color Colour)[] KitchenColours =
    {
        ("Sage", Color.FromArgb(118, 140, 110)), ("Navy", Color.FromArgb(38, 52, 78)), ("Cream", Color.FromArgb(238, 230, 212)),
        ("White", Color.FromArgb(244, 243, 239)), ("Clay", Color.FromArgb(176, 104, 76)), ("Forest", Color.FromArgb(46, 74, 60)),
        ("Graphite", Color.FromArgb(58, 60, 64)), ("Sand", Color.FromArgb(198, 180, 150))
    };

    // Worktop, its material preset, and the two tones of its thumbnail.
    static readonly (string Name, string Preset, Color A, Color B)[] KitchenWorktops =
    {
        ("Oak", "Oak, oiled", Color.FromArgb(196, 156, 108), Color.FromArgb(176, 136, 90)),
        ("Walnut", "Walnut", Color.FromArgb(107, 71, 46), Color.FromArgb(88, 56, 36)),
        ("Marble", "Marble, polished", Color.FromArgb(236, 236, 234), Color.FromArgb(176, 178, 182)),
        ("Terrazzo", "Terrazzo", Color.FromArgb(222, 216, 204), Color.FromArgb(150, 110, 92)),
        ("Slate", "Slate, cleft", Color.FromArgb(63, 69, 76), Color.FromArgb(84, 90, 98)),
        ("Concrete", "Concrete", Color.FromArgb(150, 150, 148), Color.FromArgb(128, 128, 126)),
        ("Travertine", "Travertine, honed", Color.FromArgb(217, 205, 182), Color.FromArgb(190, 174, 148))
    };

    // The colours each style comes in, and the worktops that suit each colour.
    static readonly (string Style, string Colour, string[] Worktops)[] KitchenPalette =
    {
        ("Shaker", "Sage", new[] { "Oak", "Marble" }),
        ("Shaker", "Navy", new[] { "Marble", "Oak", "Terrazzo" }),
        ("Shaker", "Cream", new[] { "Walnut", "Oak", "Slate" }),
        ("Slab", "White", new[] { "Oak", "Concrete", "Slate" }),
        ("Slab", "Clay", new[] { "Travertine", "Oak" }),
        ("Slab", "Forest", new[] { "Walnut", "Marble" }),
        ("Handleless", "Graphite", new[] { "Concrete", "Marble", "Walnut" }),
        ("Handleless", "White", new[] { "Slate", "Concrete" }),
        ("Handleless", "Sand", new[] { "Travertine", "Slate" })
    };

    static List<(IGH_DocumentObject, object)> Kitchen(B b)
    {
        b.Note("KITCHEN RUN\nA kitchen configurator on Selva's three dependent-form components. Repeat: the layout decides which cabinets " +
               "exist, and each gets its own front and handle. Options Table: two small tables list what goes together, fronts and handles " +
               "per style, and the colours and worktops that suit each other. Set Dynamic Value List: the unit heights that fit under the " +
               "ceiling. Grasshopper checks every pick in the solve, so every change is one solve.", w: 560, h: 100);

        var nKitchen = b.Note("KITCHEN\nLayout changes the cabinets, so the form waits for its solve. Style only narrows lists. Metal is the " +
                              "finish of the handles, the tap and the pendants.");
        var layout = b.Choice("Layout", 2, KitchenLayouts);
        var style = b.Choice("Style", 0, KitchenStyles);
        var metal = b.Choice("Metal", 0, KitchenMetals);
        var wallUnits = b.Switch("Wall units", true);
        var lights = b.Switch("Lights on", true);
        b.Section("Kitchen", nKitchen);

        // ---- Unit height: options computed in the solve
        var nHeight = b.Note("UNIT HEIGHT\nSet Dynamic Value List sends options computed in the solve: the wall unit heights that fit under " +
                             "the ceiling, 150 mm clear. Its output goes into Unit height and into a Context Bake. Lower the ceiling and " +
                             "a height that no longer fits falls back to the first one, in the same solve.", w: 400);
        var ceiling = b.Number("Ceiling height", 2300, 2500, 2800, 0);
        var heights = b.Panel("500\n700\n900\n1100", name: "Unit heights made", w: 120, h: 80);
        var fits = b.Ev("x + 1600 <= y", "Fits under the ceiling", heights, ceiling);
        var offered = b.CullPattern(List: heights, CullPattern: fits, nick: "Heights that fit");
        var heightLines = b.Format(Format: "\"{0} mm\" = {0}", Data0: offered, nick: "Height options");
        var setHeight = b.SetDynamicValueList(Options: heightLines, nick: "Unit height options");
        var unitHeight = b.Add(GetDynamicValueList, nick: "Unit height");
        b.W(setHeight.Obj, unitHeight, null);
        unitHeight.GetType().GetMethod("SetValue", new[] { typeof(string) }).Invoke(unitHeight, new object[] { "700" });
        b.Output("Unit height options", setHeight.Obj);
        b.Section("Unit height", nHeight);

        var (keys, labels, sections, repeat) = CabinetRows(b, layout);

        // ---- Fronts and handles: one table, a driving input and two chained ones
        var nOptions = b.Note("FRONTS AND HANDLES\nOne line per combination that exists. Style goes into By: it narrows the table and keeps " +
                              "its own options. The output goes into Fronts, and Fronts into Handles: each reads the column named like it " +
                              "and offers what is left. Repeat shows both once per cabinet, and each cabinet narrows on its own. Delete " +
                              "Options Table and swap Fronts and Handles for Value Lists, and the kitchen still solves.", w: 400, h: 110);
        var lines = new[] { "Style, Fronts, Handles" }.Concat(
            KitchenOptions.SelectMany(o => o.Handles.Select(handle => $"{o.Style}, {o.Front}, {handle}"))).ToArray();
        var table = b.Panel(string.Join("\n", lines), name: "Fronts and handles", w: 260, h: 20 * lines.Length);
        var options = b.Add(OptionsTable, nick: "Cabinet options");
        b.W(table, options, "Table");
        b.W(style, options, "By");
        var fronts = b.Add(GetDynamicValueList, nick: "Fronts");
        b.W(options, fronts, null);
        b.W(repeat, fronts, null);
        var handles = b.Add(GetDynamicValueList, nick: "Handles");
        b.W(fronts, handles, null);
        b.W(repeat, handles, null);
        // A repeated input's value is one JSON object of row key to pick.
        void Picks(IGH_DocumentObject get, Func<(string Key, string Front, string Handle), string> pick) =>
            get.GetType().GetMethod("SetValue", new[] { typeof(string) }).Invoke(get, new object[]
            {
                new JObject(KitchenDefaults.Select(d => new JProperty(d.Key, pick(d)))).ToString(Newtonsoft.Json.Formatting.None)
            });
        Picks(fronts, d => d.Front);
        Picks(handles, d => d.Handle);
        b.Output("Cabinet options", options);
        b.Section("Fronts and handles", nOptions);

        // ---- Colour and worktop: a second table on the same style
        var nPalette = b.Note("COLOUR AND WORKTOP\nThe same wiring without Repeat: each style comes in three colours, and each colour offers " +
                              "the worktops that suit it. Nobody can pick a pair that was never meant to meet.", w: 400);
        var paletteLines = new[] { "Style, Colour, Worktop" }.Concat(
            KitchenPalette.SelectMany(p => p.Worktops.Select(top => $"{p.Style}, {p.Colour}, {top}"))).ToArray();
        var paletteTable = b.Panel(string.Join("\n", paletteLines), name: "Colours and worktops", w: 260, h: 20 * paletteLines.Length);
        var palette = b.Add(OptionsTable, nick: "Palette");
        b.W(paletteTable, palette, "Table");
        b.W(style, palette, "By");
        var colour = b.Add(GetDynamicValueList, nick: "Colour");
        b.W(palette, colour, null);
        var worktop = b.Add(GetDynamicValueList, nick: "Worktop");
        b.W(colour, worktop, null);
        b.Output("Palette", palette);
        b.Section("Colour and worktop", nPalette);

        var nScript = b.Note("KITCHEN SCRIPT\nBuilds the room and one cabinet per row from the resolved picks: carcass, fronts, pulls, sink, hob, " +
                             "hood, wall units or a shelf, the island's stools and pendants. It also prices every row. Source: " +
                             "Kitchen.script.cs beside the generator.", w: 460);
        var kitchen = Script(b, "Kitchen", "Kitchen.script.cs",
            new (string, object)[]
            {
                ("*Keys", keys), ("*Labels", labels), ("*Sections", sections), ("*Fronts", fronts), ("*Handles", handles),
                ("WorktopName", worktop), ("WallUnits", wallUnits), ("LightsOn", lights), ("UnitHeight", unitHeight), ("Ceiling", ceiling)
            },
            "Carcass", "Panels", "Glass", "Metal", "Steel", "Dark", "Top", "Splash", "Glow", "Walls", "Floor", "GlowStrength", "Lumens",
            "Lines", "Csv", "PartNames", "PartEur", "Total", "TopMetres");
        GhOut K(string output) => H.Out(kitchen, output);
        b.Section("Kitchen script", nScript, kitchen);

        var model = KitchenView(b, K, colour, worktop, metal);
        var (figure, csv, file) = KitchenOrder(b, kitchen, K, model);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(KitchenForm());

        return new List<(IGH_DocumentObject, object)>
        {
            (repeat, 0), (options, 0), (palette, 0), (fronts, null), (handles, null), (colour, null), (worktop, null), (setHeight.Obj, null), (unitHeight, null),
            (kitchen, "Lines"), (kitchen, "Total"), (model, null), (figure, null), (csv, null), (file, null)
        };
    }

    // ============================================================================
    // Sections
    // ============================================================================

    // The rows: one cabinet per key, from the layout.
    static (IGH_DocumentObject Keys, IGH_DocumentObject Labels, IGH_DocumentObject Sections, IGH_DocumentObject Repeat)
        CabinetRows(B b, IGH_DocumentObject layout)
    {
        var nRows = b.Note("CABINETS\nRepeat's output wired into a Get Dynamic Value List shows that input once per row. Each row has a key, " +
                           "and a pick is stored by key, so it stays with its cabinet when the layout changes.", w: 400);
        var layoutIndex = b.IndexOf(layout, "Layout index", KitchenLayouts);
        IGH_DocumentObject Pick(string nick, Func<(string Key, string Label, string Section, string Layouts), string> field)
        {
            var streams = KitchenLayouts.Select(name => b.Panel(
                string.Join("\n", Cabinets.Where(c => c.Layouts.Contains(name[0])).Select(field)),
                name: $"{nick}, {name.ToLowerInvariant()}", w: 150, h: 20 * Cabinets.Count(c => c.Layouts.Contains(name[0])))).ToArray();
            var gate = b.StreamFilter(Gate: layoutIndex, Stream0: streams[0], Stream1: streams[1], inputs: 4, nick: nick);
            b.Feed(gate.Obj, 3, streams[2]);
            return gate.Obj;
        }

        var keys = Pick("Cabinet keys", c => c.Key);
        var labels = Pick("Cabinet labels", c => c.Label);
        var sections = Pick("Cabinet walls", c => c.Section);
        var repeat = b.Add(Repeat, nick: "Cabinets");
        b.W(keys, repeat, "Keys");
        b.W(labels, repeat, "Labels");
        b.W(sections, repeat, "Section");
        b.Output("Cabinets", repeat);
        b.Section("Cabinets", nRows);
        return (keys, labels, sections, repeat);
    }

    // One material per pick and one Display per part. Returns the combined display.
    static IGH_DocumentObject KitchenView(B b, Func<string, GhOut> K, IGH_DocumentObject colour, IGH_DocumentObject worktop, IGH_DocumentObject metal)
    {
        var nLook = b.Note("MATERIALS\nEach pick's index takes its row from a small table: a colour for the fronts, a preset for the worktop " +
                           "and for the metal.", w: 400);
        var colourIndex = b.IndexOf(colour, "Colour index", KitchenColours.Select(c => c.Name).ToArray());
        var swatches = KitchenColours.Select(c => { var s = b.Swatch(c.Colour); s.NickName = c.Name; return (object)s; }).ToArray();
        var frontMat = b.ThreeMaterial(Color: b.ListItem(List: b.MergeAll("Front colours", false, swatches), Index: colourIndex, nick: "Front colour"),
            Metalness: 0.0, Roughness: 0.45, nick: "Fronts");
        var topIndex = b.IndexOf(worktop, "Worktop index", KitchenWorktops.Select(t => t.Name).ToArray());
        var topMat = b.MaterialPreset(Preset: b.Lookup(topIndex, "I", "Worktop preset", KitchenWorktops.Select(t => PresetText(t.Preset)).ToArray()),
            nick: "Worktop");
        var metalIndex = b.IndexOf(metal, "Metal index", KitchenMetals);
        var metalMat = b.MaterialPreset(Preset: b.Lookup(metalIndex, "I", "Metal preset", PresetText("Brass"),
            PresetText("Stainless steel, brushed"), PresetText("Plastic, matte")), nick: "Metal");
        b.Section("Materials", nLook);

        var nView = b.Note("3D VIEW\nOne Display per part, each on its own layer. The strips under the wall units and the pendants are " +
                           "emissive: switch the viewer to Night. Off, they keep their material at strength 0.", w: 400);
        var carcassMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(232, 222, 204)), Metalness: 0.0, Roughness: 0.7, nick: "Carcass");
        var glassMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(230, 240, 240)), Metalness: 0.0, Roughness: 0.05, Transmission: 1.0,
            nick: "Glass");
        var darkMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(30, 31, 34)), Metalness: 0.0, Roughness: 0.35, nick: "Black");
        var splashMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(240, 237, 228)), Metalness: 0.0, Roughness: 0.12, nick: "Tiles");
        var bulb = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(255, 250, 236)), Metalness: 0.0, Roughness: 0.25, nick: "Bulb");
        var glowMat = b.EmissiveMaterial(Color: b.Swatch(Color.FromArgb(255, 226, 184)), Strength: K("GlowStrength"), Base: bulb, Kelvin: 2700.0,
            Lumens: K("Lumens"), nick: "Light");
        var shows = new[]
        {
            b.Display(Geo: K("Carcass"), Name: "Carcass", Layer: "Kitchen/Carcass", Material: carcassMat, nick: "Carcass"),
            b.Display(Geo: K("Panels"), Name: "Fronts", Layer: "Kitchen/Fronts", Material: frontMat, nick: "Fronts"),
            b.Display(Geo: K("Glass"), Name: "Glass", Layer: "Kitchen/Glass", Material: glassMat, nick: "Glass"),
            b.Display(Geo: K("Metal"), Name: "Handles and tap", Layer: "Kitchen/Metal", Material: metalMat, nick: "Metal"),
            b.Display(Geo: K("Steel"), Name: "Sink, hob and hood", Layer: "Kitchen/Appliances", Material: b.MaterialPreset(
                Preset: PresetText("Stainless steel, brushed"), nick: "Steel"), nick: "Appliances"),
            b.Display(Geo: K("Dark"), Name: "Plinth and stools", Layer: "Kitchen/Black", Material: darkMat, nick: "Black parts"),
            b.Display(Geo: K("Top"), Name: "Worktop", Layer: "Kitchen/Worktop", Material: topMat, nick: "Worktop"),
            b.Display(Geo: K("Splash"), Name: "Splashback", Layer: "Kitchen/Splashback", Material: splashMat, nick: "Splashback"),
            b.Display(Geo: K("Glow"), Name: "Lights", Layer: "Kitchen/Lights", Material: glowMat, nick: "Lights"),
            b.Display(Geo: K("Walls"), Name: "Walls", Layer: "Room/Walls", Material: b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(206, 198, 184)),
                Metalness: 0.0, Roughness: 0.9, nick: "Wall paint"), nick: "Walls"),
            b.Display(Geo: K("Floor"), Name: "Floor", Layer: "Room/Floor", Material: b.MaterialPreset(Preset: PresetText("Wood"),
                nick: "Wood floor"), nick: "Floor")
        };
        var combine = b.CombineDisplay(nick: "Kitchen");
        foreach (var show in shows) b.Feed(combine.Obj, 0, show);
        b.Output("Kitchen", combine.Obj);
        b.Section("3D view", nView);
        return combine.Obj;
    }

    // Price, cabinet list and downloads. Returns the chart and the two files.
    static (IGH_DocumentObject Figure, IGH_DocumentObject Csv, IGH_DocumentObject Model) KitchenOrder(B b, IGH_Component kitchen,
        Func<string, GhOut> K, IGH_DocumentObject model)
    {
        var nOrder = b.Note("ORDER\nThe script prices each cabinet from its picks, the worktop by the metre, and the sink, hob and hood. " +
                            "One Context Print per value; the labels are what the page shows.", w: 400);
        var pie = b.PieChart(Values: K("PartEur"), Labels: K("PartNames"), Hole: true, nick: "Price slices");
        var figure = b.Figure(Traces: pie, Layout: b.Layout(Title: "Where the money goes (EUR)"), nick: "Price chart");
        b.Output("Price breakdown", figure.Obj);
        b.Print("Total (EUR)", kitchen, "Total");
        b.Print("Worktop (m)", kitchen, "TopMetres");
        b.Print("Cabinet list", kitchen, "Lines");
        b.Section("Order", nOrder);

        var nFiles = b.Note("DOWNLOADS\nThe order as a CSV, and the model as a 3DM with the 3D view's layers and colours.", w: 400);
        var csv = b.CreateFile(Data: K("Csv"), Name: "kitchen-order", Extension: ".csv", IsBase64: false, nick: "Order list");
        b.Output("Order list (CSV)", csv.Obj);
        var parts3d = b.DeconstructDisplay(WebDisplay: model, nick: "Model parts");
        var meshes = b.MergeAll("Kitchen parts", true, K("Carcass"), K("Panels"), K("Glass"), K("Metal"), K("Steel"), K("Dark"), K("Top"),
            K("Splash"), K("Glow"), K("Walls"), K("Floor"));
        var file = b.GeometryToFile(Geometry: Flatten(meshes), LayerNames: Flatten(parts3d.Layers), LayerColors: Flatten(parts3d.Colors),
            FileNames: "kitchen-run", FileEnding: ".3dm", nick: "Model");
        b.Output("Model (3DM)", file.Obj);
        b.Section("Downloads", nFiles);
        return (figure.Obj, csv.Obj, file.Obj);
    }

    // ============================================================================
    // Form
    // ============================================================================

    static string KitchenForm()
    {
        var assets = new JObject();
        void Icon(string key, string d) => assets[key] = new JObject { ["d"] = d };
        void Image(string key, string img) => assets[key] = new JObject { ["img"] = img };

        // Plans seen from above.
        Icon("ic-straight", "M3 6h18v5H3z");
        Icon("ic-l", "M3 5h18v14h-5v-9H3z");
        Icon("ic-island", "M3 4h18v5H3z M6 14h12v5H6z");

        Image("th-shaker", DoorThumb(KitchenColours[0].Colour, "Shaker"));
        Image("th-slab", DoorThumb(KitchenColours[3].Colour, "Slab"));
        Image("th-handleless", DoorThumb(KitchenColours[6].Colour, "Handleless"));

        Icon("ic-shaker-door", "M5 3h14v18H5z M8 6h8v12H8z");
        Icon("ic-slab-door", "M5 3h14v18H5z M16 10v4");
        Icon("ic-push-door", "M5 3h14v18H5z");
        Icon("ic-glazed-door", "M5 3h14v18H5z M8 6h8v12H8z M12 6v12 M8 12h8");
        Icon("ic-shaker-drawers", "M4 4h16v16H4z M4 9.3h16 M4 14.7h16 M11 6.7h2 M11 12h2 M11 17.3h2");
        Icon("ic-drawers", "M4 4h16v16H4z M4 9.3h16 M4 14.7h16");
        Icon("ic-open-shelves", "M5 3v18 M19 3v18 M5 4h14 M5 12h14 M5 20h14");

        Icon("ic-knob", "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0");
        Icon("ic-bar", "M12 4v16 M12 7h4 M12 17h4");
        Icon("ic-cup-pull", "M5 10h14a7 6 0 0 1-14 0z");
        Icon("ic-edge-pull", "M4 8h16 M7 8v4h10V8");
        Icon("ic-none", "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M6.5 6.5l11 11");

        foreach (var (name, c) in KitchenColours) Image("th-" + name.ToLowerInvariant(), H.Thumb(c));
        foreach (var (name, _, a, c) in KitchenWorktops) Image("top-" + name.ToLowerInvariant(), StoneThumb(name, a, c));
        Image("th-brass", H.Stripes(Color.FromArgb(206, 168, 98), Color.FromArgb(190, 150, 80), 12));
        Image("th-steel", H.Stripes(Color.FromArgb(200, 202, 206), Color.FromArgb(180, 182, 186), 12));
        Image("th-black", H.Thumb(Color.FromArgb(30, 31, 34)));

        static string Media(string kind, IEnumerable<(string Option, string Asset)> entries) =>
            "'optionMedia': { " + string.Join(", ", entries.Select(e => $"'{e.Option}': {{ '{kind}': '{e.Asset}' }}")) + " }";

        var frontIcons = Media("icon", new[]
        {
            ("Shaker door", "ic-shaker-door"), ("Shaker drawers", "ic-shaker-drawers"), ("Glazed door", "ic-glazed-door"),
            ("Open shelves", "ic-open-shelves"), ("Slab door", "ic-slab-door"), ("Slab drawers", "ic-drawers"),
            ("Push door", "ic-push-door"), ("Push drawers", "ic-drawers")
        });
        var handleIcons = Media("icon", new[]
        {
            ("Knob", "ic-knob"), ("Bar", "ic-bar"), ("Cup pull", "ic-cup-pull"), ("Edge pull", "ic-edge-pull"), ("None", "ic-none")
        });
        var colourThumbs = Media("image", KitchenColours.Select(c => (c.Name, "th-" + c.Name.ToLowerInvariant())));
        var worktopThumbs = Media("image", KitchenWorktops.Select(t => (t.Name, "top-" + t.Name.ToLowerInvariant())));

        return Json(@"{
  'name': 'Kitchen run',
  'description': 'Design a kitchen: layout, style, a colour and worktop that suit each other, then a front and a handle for every cabinet. Priced as you go.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e4e1da', 'look': 'showcase' },
  'assets': ASSETS,
  'tabs': [
    { 'label': 'Design', 'groups': [
      { 'label': 'Kitchen', 'items': [
        { 'param': 'Layout', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Straight': { 'icon': 'ic-straight' }, 'L-shaped': { 'icon': 'ic-l' }, 'Island': { 'icon': 'ic-island' } } } },
        { 'param': 'Style', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Shaker': { 'image': 'th-shaker' }, 'Slab': { 'image': 'th-slab' }, 'Handleless': { 'image': 'th-handleless' } } } }
      ] },
      { 'label': 'Colour and worktop', 'items': [
        { 'param': 'Colour', 'description': 'The colours this style comes in.', 'config': { 'displayAs': 'tiles', " + colourThumbs + @" } },
        { 'param': 'Worktop', 'description': 'Only the worktops that suit the colour.', 'config': { 'displayAs': 'tiles', " + worktopThumbs + @" } }
      ] },
      { 'label': 'Details', 'items': [
        { 'param': 'Metal', 'label': 'Handles, tap and pendants', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented', 'optionMedia': {
            'Brass': { 'image': 'th-brass' }, 'Steel': { 'image': 'th-steel' }, 'Black': { 'image': 'th-black' } } } },
        { 'param': 'Wall units', 'description': 'Off leaves an open shelf.' },
        { 'param': 'Ceiling height', 'label': 'Ceiling height (mm)', " + SliderConfig + @" },
        { 'param': 'Unit height', 'label': 'Wall unit height', 'description': 'Only the heights that fit under the ceiling.', 'config': { 'displayAs': 'segmented' } },
        { 'param': 'Lights on', 'description': 'Switch the viewer to Night to see them.' }
      ] }
    ] },
    { 'label': 'Cabinets', 'groups': [
      { 'label': 'Cabinets', 'items': [
        { 'param': 'Fronts', 'config': { " + frontIcons + @" } },
        { 'param': 'Handles', 'config': { " + handleIcons + @" } }
      ] }
    ] },
    { 'label': 'Order', 'groups': [
      { 'label': 'Price', 'items': [ 'Total (EUR)', 'Worktop (m)', 'Price breakdown' ] },
      { 'label': 'Cabinets', 'items': [ 'Cabinet list' ] },
      { 'label': 'Downloads', 'items': [ 'Order list (CSV)', 'Model (3DM)' ] }
    ] }
  ]
}").Replace("ASSETS", assets.ToString(Newtonsoft.Json.Formatting.None));
    }

    /// <summary>A 48 px door in the style's manner, as a PNG data URI.</summary>
    static string DoorThumb(Color face, string style)
    {
        using var bmp = new Bitmap(48, 48);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(face);
            Color Tone(double f) => Color.FromArgb((int)Math.Clamp(face.R * f, 0, 255), (int)Math.Clamp(face.G * f, 0, 255), (int)Math.Clamp(face.B * f, 0, 255));
            var dark = Tone(0.78);
            var light = Tone(1.12);
            using var shade = new Pen(dark, 2);
            using var brass = new SolidBrush(Color.FromArgb(196, 160, 98));
            switch (style)
            {
                case "Shaker":
                    using (var rim = new Pen(light, 2)) g.DrawRectangle(rim, 9, 9, 30, 30);
                    g.DrawRectangle(shade, 10, 10, 30, 30);
                    g.FillEllipse(brass, 38, 21, 6, 6);
                    break;
                case "Slab":
                    g.DrawLine(shade, 24, 0, 24, 48);
                    g.FillRectangle(brass, 18, 14, 2, 20);
                    g.FillRectangle(brass, 28, 14, 2, 20);
                    break;
                default:
                    g.DrawLine(shade, 0, 16, 48, 16);
                    g.DrawLine(shade, 0, 32, 48, 32);
                    break;
            }
        }
        using var ms = new MemoryStream();
        bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
    }

    /// <summary>A 48 px worktop sample: grain for wood, veins for marble, chips for terrazzo, a flat mottle otherwise.</summary>
    static string StoneThumb(string name, Color a, Color c)
    {
        if (name == "Oak" || name == "Walnut") return H.Stripes(a, c);
        using var bmp = new Bitmap(48, 48);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(a);
            var random = new Random(name.Length * 97);
            using var pen = new Pen(c, 1.4f);
            using var brush = new SolidBrush(c);
            if (name == "Marble")
            {
                for (var v = 0; v < 3; v++)
                {
                    var y = 8 + v * 16;
                    g.DrawBezier(pen, -4, y, 14, y + random.Next(-12, 12), 30, y + random.Next(-12, 12), 52, y + random.Next(-6, 6));
                }
            }
            else
            {
                var chips = name == "Terrazzo" ? 46 : 90;
                var size = name == "Terrazzo" ? 4 : 2;
                for (var i = 0; i < chips; i++) g.FillEllipse(brush, random.Next(48), random.Next(48), size, size - 1);
            }
        }
        using var ms = new MemoryStream();
        bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
    }
}
