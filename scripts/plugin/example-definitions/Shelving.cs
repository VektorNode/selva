using Grasshopper.Kernel;
using System.Collections.Generic;
using System.Drawing;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Shelving unit: dynamic value lists
    // ============================================================================

    const string NumberParam = "3e8ca6be-fda8-4aaf-b5c0-3c54c8bb7312";

    static List<(IGH_DocumentObject, object)> Shelving(B b)
    {
        b.Note("SHELVING UNIT\nDynamic value lists: Grasshopper computes the options from the size, and each Set Dynamic Value List is " +
               "wired into the Get Dynamic Value List it fills. The pick is then checked against the options in the same solve, so " +
               "Width → Bays → Doors is one solve, and a pick no longer offered falls back to the first option.", w: 560, h: 80);

        var nSize = b.Note("SIZE\nWidth and height decide which bay and shelf counts fit, so they decide the options of the lists below.");
        var width = b.Number("Width", 600, 1500, 2400, 0);
        var height = b.Number("Height", 700, 1800, 2200, 0);
        var depth = b.Number("Depth", 250, 350, 450, 0);
        b.Section("Size", nSize);

        var nFinish = b.Note("FINISH\nStatic value lists, for comparison: their options never change.");
        var wood = b.Choice("Wood", 0, "Oak", "Walnut", "Maple");
        var doorColour = b.Choice("Door colour", 0, "White", "Sage", "Charcoal", "Terracotta");
        b.Section("Finish", nFinish);

        // ---- Bays: options from the width
        var nBays = b.Note("BAYS\nEvery bay count whose bays come out 350 to 800 mm wide, written as \"name\" = value. The output is wired " +
                           "into Bays as well as into the Context Bake: that wire is what makes Bays check its pick in this solve.", w: 400);
        var fewestBays = b.Ev("Ceiling(x/800)", "Fewest bays", width);
        var mostBays = b.Ev("Floor(x/350)", "Most bays", width);
        var bayCounts = b.Series(Start: fewestBays, Step: 1, Count: b.Ev("y-x+1", "Bay choices", fewestBays, mostBays), nick: "Bay counts");
        var bayPairs = b.Format(Format: "\"{0} ({1:0} mm wide)\" = {0}", Data0: bayCounts, Data1: b.Ev("x/y", "Bay width", width, bayCounts),
            nick: "Bay pairs");
        var setBays = b.SetDynamicValueList(Options: bayPairs, nick: "Bay options");
        var bays = b.Add(GetDynamicValueList, nick: "Bays");
        b.W(setBays.Obj, bays, null);
        var oBays = b.Output("Bay options", setBays.Obj);
        b.Section("Bays", nBays);

        // ---- Shelves: options from the height
        var nShelves = b.Note("SHELVES\nEvery shelf count that spaces the shelves 230 to 420 mm apart in the height between the bottom and the top.");
        var clear = b.Ev("x-96", "Clear height", height);
        var fewestShelves = b.Ev("Ceiling(x/420)-1", "Fewest shelves", clear);
        var mostShelves = b.Ev("Floor(x/230)-1", "Most shelves", clear);
        var shelfCounts = b.Series(Start: fewestShelves, Step: 1, Count: b.Ev("y-x+1", "Shelf choices", fewestShelves, mostShelves),
            nick: "Shelf counts");
        var shelfPairs = b.Format(Format: "\"{0} ({1:0} mm apart)\" = {0}", Data0: shelfCounts,
            Data1: b.Ev("x/(y+1)", "Spacing", clear, shelfCounts), nick: "Shelf pairs");
        var setShelves = b.SetDynamicValueList(Options: shelfPairs, nick: "Shelf options");
        var shelves = b.Add(GetDynamicValueList, nick: "Shelves");
        b.W(setShelves.Obj, shelves, null);
        var oShelves = b.Output("Shelf options", setShelves.Obj);
        b.Section("Shelves", nShelves);

        // ---- Doors: options from the bay count Bays resolved to
        var nDoors = b.Note("DOORS\nThe door patterns that fit the bay count Bays resolved to in this solve: Outer bays needs three bays, " +
                            "Left bay and Alternate bays two. A chain of two lists, and still one solve.", w: 400);
        var patterns = b.Panel("\"None\" = None\n\"All bays\" = All bays\n\"Left bay\" = Left bay\n\"Alternate bays\" = Alternate bays\n" +
                               "\"Outer bays\" = Outer bays", name: "Door patterns", w: 230, h: 100);
        // A Panel's lines are text, which Evaluate won't compare with a number.
        var needs = b.Add(NumberParam, nick: "Bays needed");
        b.W(b.Panel("1\n1\n2\n2\n3", name: "Bays needed, per pattern", h: 100), needs, null);
        var bayCount = b.Add(NumberParam, nick: "Bay count");
        b.W(b.ChoiceText(bays), bayCount, null);
        var doorPairs = b.CullPattern(List: patterns, CullPattern: b.Ev("x<=y", "Fits", needs, bayCount), nick: "Door pairs");
        var setDoors = b.SetDynamicValueList(Options: doorPairs, nick: "Door options");
        var doors = b.Add(GetDynamicValueList, nick: "Doors");
        b.W(setDoors.Obj, doors, null);
        var oDoors = b.Output("Door options", setDoors.Obj);
        b.Section("Doors", nDoors);

        // ---- The unit
        var nScript = b.Note("SHELVING SCRIPT\nBuilds the unit from the resolved picks. Source: Shelving.script.cs beside the generator.");
        var unit = Script(b, "Shelving", "Shelving.script.cs",
            new (string, object)[] { ("Width", width), ("Height", height), ("Depth", depth), ("Bays", bays), ("Shelves", shelves), ("Doors", doors) },
            "Carcass", "Fronts", "Knobs", "Floor", "Summary");
        GhOut S(string output) => H.Out(unit, output);
        b.Section("Shelving script", nScript, unit);

        var nView = b.Note("3D VIEW\nOne Display per part. Wood picks a material preset; the doors take a paint colour.");
        var woodIndex = b.IndexOf(wood, "Wood index", "Oak", "Walnut", "Maple");
        var woodMat = b.MaterialPreset(Preset: b.Lookup(woodIndex, "I", "Wood preset",
            PresetText("Oak, oiled"), PresetText("Walnut"), PresetText("Maple, lacquered")), nick: "Wood");
        var paintIndex = b.IndexOf(doorColour, "Door colour index", "White", "Sage", "Charcoal", "Terracotta");
        var paints = b.MergeAll("Door paints", false, b.Swatch(Color.FromArgb(240, 238, 232)), b.Swatch(Color.FromArgb(150, 168, 140)),
            b.Swatch(Color.FromArgb(58, 60, 64)), b.Swatch(Color.FromArgb(184, 98, 70)));
        var doorMat = b.ThreeMaterial(Color: b.ListItem(List: paints, Index: paintIndex, nick: "Door paint"), Metalness: 0.0, Roughness: 0.55,
            nick: "Door paint");
        var knobMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(70, 70, 72)), Metalness: 1.0, Roughness: 0.35, nick: "Knob");
        var floorMat = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(214, 210, 202)), Metalness: 0.0, Roughness: 0.9, nick: "Floor");
        var combine = b.CombineDisplay(nick: "Shelving unit");
        b.Feed(combine.Obj, 0, b.Display(Geo: S("Carcass"), Name: "Carcass", Layer: "Shelving/Carcass", Material: woodMat, nick: "Carcass"));
        b.Feed(combine.Obj, 0, b.Display(Geo: S("Fronts"), Name: "Doors", Layer: "Shelving/Doors", Material: doorMat, nick: "Doors"));
        b.Feed(combine.Obj, 0, b.Display(Geo: S("Knobs"), Name: "Knobs", Layer: "Shelving/Knobs", Material: knobMat, nick: "Knobs"));
        b.Feed(combine.Obj, 0, b.Display(Geo: S("Floor"), Name: "Floor", Layer: "Context/Floor", Material: floorMat, nick: "Floor"));
        var oModel = b.Output("Shelving unit", combine.Obj);
        b.Section("3D view", nView);

        var nResult = b.Note("RESULT\nWhat the solve built, from the picks it resolved.");
        var pSummary = b.Print("Summary", unit, "Summary");
        b.Section("Result", nResult);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(Json(@"{
  'name': 'Shelving unit',
  'description': 'A shelving unit whose bay, shelf and door options follow its size.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e4e1da', 'look': 'showcase' },
  'tabs': [ { 'label': 'Shelving', 'groups': [
    { 'label': 'Size', 'items': [
      { 'param': 'Width', 'label': 'Width (mm)', " + SliderConfig + @" },
      { 'param': 'Height', 'label': 'Height (mm)', " + SliderConfig + @" },
      { 'param': 'Depth', 'label': 'Depth (mm)', " + SliderConfig + @" } ] },
    { 'label': 'Layout', 'items': [ 'Bays', 'Shelves', 'Doors' ] },
    { 'label': 'Finish', 'items': [ 'Wood', 'Door colour' ] },
    { 'label': 'Result', 'items': [ 'Summary' ] } ] } ] }"));

        return new List<(IGH_DocumentObject, object)>
        {
            (setBays.Obj, null), (setShelves.Obj, null), (setDoors.Obj, null), (unit, "Summary"), (combine.Obj, null)
        };
    }
}
