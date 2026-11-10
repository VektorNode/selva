using Grasshopper.Kernel;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Kitchen run: Options By and Repeat
    // ============================================================================

    const string OptionsBy = "6c1e2b7a-4d3f-4e8b-9a15-2f7c0d6e8b31";
    const string Repeat = "3b8f5d21-7c6a-4e19-a2d4-8e0b1c9f6a57";
    const string TextParam = "3ede854e-c753-40eb-84cb-b48008f14fd4";

    static readonly string[] KitchenLayouts = { "Straight", "L-shaped", "Island" };

    // Key, label, section, and the layouts (by first letter) that have the cabinet. The L's corner is
    // a blind cabinet the script adds; it has no front to pick.
    static readonly (string Key, string Label, string Section, string Layouts)[] Cabinets =
    {
        ("back/sink", "Sink", "Back wall", "SLI"),
        ("back/drawers", "Drawers", "Back wall", "SLI"),
        ("back/hob", "Hob", "Back wall", "SLI"),
        ("back/larder", "Larder", "Back wall", "S"),
        ("side/drawers", "Pan drawers", "Side wall", "L"),
        ("side/cupboard", "Cupboard", "Side wall", "L"),
        ("side/larder", "Larder", "Side wall", "L"),
        ("island/drawers", "Pan drawers", "Island", "I"),
        ("island/cupboard", "Cupboard", "Island", "I"),
        ("island/shelves", "Open end", "Island", "I")
    };

    static List<(IGH_DocumentObject, object)> Kitchen(B b)
    {
        b.Note("KITCHEN RUN\nOptions By and Repeat. The layout decides which cabinets exist, the style decides the fronts offered, and each " +
               "cabinet's front decides its handles. The browser switches every list from the tables without a solve, and Grasshopper " +
               "checks each pick in the solve, so every change is one solve.", w: 560, h: 80);

        var nKitchen = b.Note("KITCHEN\nLayout changes the cabinets, so the form waits for its solve. Style only switches lists.");
        var layout = b.Choice("Layout", 0, KitchenLayouts);
        var style = b.Choice("Style", 0, "Shaker", "Slab", "Handleless");
        b.Section("Kitchen", nKitchen);

        // ---- Cabinets: the rows
        var nRows = b.Note("CABINETS\nRepeat's output wired into a Get Dynamic Value List shows that input once per row. Each row has a key, " +
                           "and a pick is stored by key, so it stays with its cabinet when the layout changes.", w: 400);
        var layoutIndex = b.IndexOf(layout, "Layout index", KitchenLayouts);
        IGH_DocumentObject Pick(string nick, System.Func<(string Key, string Label, string Section, string Layouts), string> field)
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
        var oRows = b.Output("Cabinets", repeat);
        b.Section("Cabinets", nRows);

        // ---- Fronts: one branch per style
        var nFronts = b.Note("FRONTS\nOptions By: branch i holds the fronts for Style's i-th item. Its output wired into Fronts gives every " +
                             "cabinet those options; Fronts then resolves each row's pick in the same solve.", w: 400);
        var frontTable = b.Entwine(
            Branch00: b.Panel("Shaker door\nShaker drawers\nGlazed door\nOpen shelves", name: "Shaker fronts", h: 80),
            Branch01: b.Panel("Slab door\nSlab drawers\nOpen shelves", name: "Slab fronts", h: 60),
            Branch02: b.Panel("Push door\nPush drawers\nOpen shelves", name: "Handleless fronts", h: 60), inputs: 3, nick: "Front table");
        var frontsBy = b.Add(OptionsBy, nick: "Fronts by style");
        b.W(frontTable.Obj, frontsBy, "Options");
        b.W(style, frontsBy, "By");
        var fronts = b.Add(GetDynamicValueList, nick: "Fronts");
        b.W(frontsBy, fronts, null);
        b.W(repeat, fronts, null);
        var oFronts = b.Output("Front options", frontsBy);
        b.Section("Fronts", nFronts);

        // ---- Handles: keyed by each cabinet's front
        var nHandles = b.Note("HANDLES\nBy is Fronts, itself repeated, so each cabinet reads its own resolved front. Its values aren't known " +
                              "up front, so Keys names them; * is every other front.", w: 400);
        var handleTable = b.Entwine(
            Branch00: b.Panel("Cup pull\nKnob\nBar", name: "Drawer handles", h: 60),
            Branch01: b.Panel("None", name: "Push to open"),
            Branch02: b.Panel("None", name: "Push to open, drawers"), inputs: 5, nick: "Handle table");
        b.Feed(handleTable.Obj, 3, b.Panel("None", name: "No front"));
        b.Feed(handleTable.Obj, 4, b.Panel("Knob\nBar\nEdge pull", name: "Door handles", h: 60));
        var handleKeys = b.Panel("Shaker drawers\nPush door\nPush drawers\nOpen shelves\n*", name: "Handle keys", w: 150, h: 100);
        var handlesBy = b.Add(OptionsBy, nick: "Handles by front");
        b.W(handleTable.Obj, handlesBy, "Options");
        b.W(fronts, handlesBy, "By");
        b.W(handleKeys, handlesBy, "Keys");
        var handles = b.Add(GetDynamicValueList, nick: "Handles");
        b.W(handlesBy, handles, null);
        b.W(repeat, handles, null);
        var oHandles = b.Output("Handle options", handlesBy);
        b.Section("Handles", nHandles);

        // ---- The kitchen
        var nScript = b.Note("KITCHEN SCRIPT\nBuilds one cabinet per row from the resolved picks. Source: Kitchen.script.cs beside the generator.");
        var kitchen = Script(b, "Kitchen", "Kitchen.script.cs",
            new (string, object)[] { ("*Keys", keys), ("*Sections", sections), ("*Fronts", fronts), ("*Handles", handles) },
            "Carcass", "Panels", "Glass", "Pulls", "Worktop", "Floor");
        GhOut K(string output) => H.Out(kitchen, output);
        b.Section("Kitchen script", nScript, kitchen);

        var nView = b.Note("3D VIEW\nOne Display per part. The style picks the front colour.");
        var styleIndex = b.IndexOf(style, "Style index", "Shaker", "Slab", "Handleless");
        var frontColours = b.MergeAll("Front colours", false, b.Swatch(Color.FromArgb(150, 168, 140)), b.Swatch(Color.FromArgb(242, 240, 234)),
            b.Swatch(Color.FromArgb(58, 60, 64)));
        var frontMat = b.ThreeMaterial(Color: b.ListItem(List: frontColours, Index: styleIndex, nick: "Front colour"), Metalness: 0.0,
            Roughness: 0.5, nick: "Fronts");
        var carcassMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(236, 232, 224)), Metalness: 0.0, Roughness: 0.7, nick: "Carcass");
        var glassMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(230, 240, 240)), Metalness: 0.0, Roughness: 0.05, Transmission: 1.0,
            nick: "Glass");
        var pullMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(196, 160, 98)), Metalness: 1.0, Roughness: 0.3, nick: "Brass");
        var floorMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(214, 210, 202)), Metalness: 0.0, Roughness: 0.9, nick: "Floor");
        var combine = b.CombineDisplay(nick: "Kitchen");
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Carcass"), Name: "Carcass", Layer: "Kitchen/Carcass", Material: carcassMat, nick: "Carcass"));
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Panels"), Name: "Fronts", Layer: "Kitchen/Fronts", Material: frontMat, nick: "Fronts"));
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Glass"), Name: "Glass", Layer: "Kitchen/Glass", Material: glassMat, nick: "Glass"));
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Pulls"), Name: "Handles", Layer: "Kitchen/Handles", Material: pullMat, nick: "Handles"));
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Worktop"), Name: "Worktop", Layer: "Kitchen/Worktop",
            Material: b.MaterialPreset(Preset: PresetText("Oak, oiled"), nick: "Worktop"), nick: "Worktop"));
        b.Feed(combine.Obj, 0, b.Display(Geo: K("Floor"), Name: "Floor", Layer: "Context/Floor", Material: floorMat, nick: "Floor"));
        var oModel = b.Output("Kitchen", combine.Obj);
        b.Section("3D view", nView);

        // ---- Result: one line per cabinet, read back from the repeated inputs
        var nResult = b.Note("RESULT\nOne line per cabinet, from the picks the solve resolved.");
        var frontText = b.Add(TextParam, nick: "Front text");
        b.W(fronts, frontText, null);
        var handleText = b.Add(TextParam, nick: "Handle text");
        b.W(handles, handleText, null);
        var line = b.Add("Concatenate", nick: "Cabinet line");
        b.Inputs(line, 7);
        b.W(labels, line, 0);
        b.Set(line, 1, " · ");
        b.W(sections, line, 2);
        b.Set(line, 3, ": ");
        b.W(frontText, line, 4);
        b.Set(line, 5, " / ");
        b.W(handleText, line, 6);
        var lines = b.Add("Text Join", nick: "Cabinet lines");
        b.W(line, lines, "T");
        b.Set(lines, "J", "\n");
        var pResult = b.Print("Cabinet list", lines);
        b.Section("Result", nResult);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(Json(@"{
  'name': 'Kitchen run',
  'description': 'Pick a layout and a style, then a front and a handle for each cabinet.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e4e1da', 'look': 'showcase' },
  'tabs': [ { 'label': 'Kitchen', 'groups': [
    { 'label': 'Kitchen', 'items': [
      { 'param': 'Layout', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } },
      { 'param': 'Style', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } } ] },
    { 'label': 'Cabinets', 'items': [ 'Fronts', 'Handles' ] },
    { 'label': 'Result', 'items': [ 'Cabinet list' ] } ] } ] }"));

        return new List<(IGH_DocumentObject, object)>
        {
            (repeat, 0), (frontsBy, 0), (handlesBy, 0), (line, 0), (combine.Obj, null)
        };
    }
}
