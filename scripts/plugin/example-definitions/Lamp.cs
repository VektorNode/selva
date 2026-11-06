using Grasshopper.Kernel;
using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using static GhIn;
using static SelvaBuilder;

public static partial class Definitions
{
    const string LampFolder = "scripts/plugin/example-definitions";

    // ============================================================================
    // Studio task lamp
    // ============================================================================

    static List<(IGH_DocumentObject, object)> Lamp(B b)
    {
        b.Note("STUDIO TASK LAMP\nA desk lamp configurator. Three small C# Scripts do the geometry, the light on the desk and the drawing views; " +
               "the rest is stock and Selva components: a light-source list that follows the head, night-look lighting, checks, charts, " +
               "a two-sheet A3 PDF, the model and a parts list.", w: 560);

        // ---- Inputs
        var nBase = b.Note("BASE\nRound or square on the desk, or a clamp on its edge. A clamp swaps the base size for the desk thickness.");
        var baseType = b.Choice("Base", 0, "Round", "Square", "Clamp");
        var baseSize = b.Number("Base size", 120, 190, 280, 0);
        var weighted = b.Switch("Weighted base", false);
        var deskT = b.Number("Desk thickness", 15, 30, 60, 0);
        b.Section("Base", nBase);

        var nArm = b.Note("ARM\nHeight and reach place the head's knuckle. Elbow moves the joint of the two-joint arm.");
        var arm = b.Choice("Arm", 2, "Straight", "Two-Joint", "Arc");
        var height = b.Number("Height", 300, 500, 700, 0);
        var reach = b.Number("Reach", 150, 340, 600, 0);
        var elbow = b.Number("Elbow", 20, 45, 80, 0);
        b.Section("Arm", nArm);

        var nHead = b.Note("HEAD\nThe head's shape and size decide which light sources fit in it.");
        var head = b.Choice("Head", 0, "Dome", "Cone", "Cylinder", "Linear Bar");
        var headSize = b.Number("Head size", 90, 200, 260, 0);
        var barLength = b.Number("Bar length", 200, 420, 700, 0);
        var tilt = b.Number("Head tilt", 0, 22, 60, 0);
        b.Section("Head", nHead);

        var nFinish = b.Note("FINISH\nPowder coat takes a colour, or any colour from the picker under Custom. Metals carry their own.");
        var finish = b.Choice("Finish", 2, "Powder Coat", "Anodised", "Brass", "Chrome");
        var bodyColour = b.Choice("Body colour", 0, "Forest", "Oxide", "Cream", "Graphite", "Ocean", "Custom");
        var customColour = b.Colour("Custom colour", Color.FromArgb(214, 96, 52));
        var lining = b.Choice("Lining", 1, "White", "Cream", "Gold");
        var diffuser = b.Switch("Diffuser", true);
        var cableOn = b.Switch("Cable", true);
        var cableColour = b.Choice("Cable colour", 1, "Black", "Copper", "White");
        b.Section("Finish", nFinish);

        var nLight = b.Note("LIGHT AND DESK\nLight source is a dynamic value list: the lamp script computes its options, so they change with the head.");
        var lightOn = b.Switch("Light on", true);
        var kelvin = b.Number("Colour temperature", 2200, 2700, 6500, 0);
        var source = b.Add(GetDynamicValueList, nick: "Light source");
        source.GetType().GetProperty("Prompt")?.SetValue(source, "Light source");
        var desk = b.Choice("Desk", 0, "Oak", "Walnut", "Maple", "Wenge");
        b.Section("Light and desk", nLight, source);

        var nOrder = b.Note("ORDER\nThe project name goes into the spec sheet's title block. Quantity sets the price break.");
        var project = b.Text("Project", "Studio fit-out");
        var quantity = b.Number("Quantity", 1, 1, 200, 0);
        b.Section("Order", nOrder);

        // ---- The lamp
        var nScript = b.Note("LAMP SCRIPT\nBuilds the lamp in millimetres. It also reports the light sources that fit the head, the beam for the light " +
                             "on the desk, whether the lamp stands, and its parts at list price. Source: Lamp.script.cs beside the generator.", w: 460);
        var lamp = Script(b, "Lamp", "Lamp.script.cs",
            new (string, object)[]
            {
                ("Base", baseType), ("BaseSize", baseSize), ("DeskThickness", deskT), ("Weighted", weighted),
                ("Arm", arm), ("Height", height), ("Reach", reach), ("Elbow", elbow), ("Tilt", tilt),
                ("Head", head), ("HeadSize", headSize), ("BarLength", barLength), ("Diffuser", diffuser), ("CableOn", cableOn),
                ("Source", source), ("LightOn", lightOn),
            },
            "SourceOptions", "Body", "Inner", "Glass", "Light", "Cable", "Desk", "Lumens", "Beam", "Spread", "Cutoff", "Efficiency",
            "Steady", "GlareFree", "SourceName", "PowerW", "Stability", "WeightKg", "PartNames", "PartNotes", "PartEur");
        GhOut L(string output) => H.Out(lamp, output);
        b.Section("Lamp script", nScript, lamp);

        var nOptions = b.Note("LIGHT SOURCE OPTIONS\nSet Dynamic Value List sends the script's options to the Light source input, through its own output.");
        var setSource = b.SetDynamicValueList(Options: L("SourceOptions"), nick: "Light source options");
        setSource.Obj.GetType().GetProperty("TargetInputId").SetValue(setSource.Obj, source.InstanceGuid);
        var oSource = b.Output("Light source options", setSource.Obj);
        b.Section("Light source options", nOptions);

        // ---- Finish: lookups by the chosen option
        var nLook = b.Note("FINISH VALUES\nEach choice's index picks its row from a small table: metalness, roughness and clearcoat by finish, " +
                           "and a colour per option. Powder coat takes the colour list, Custom the picker.", w: 460);
        Grasshopper.Kernel.Special.GH_ColourSwatch Sw(string name, int r, int g, int bl) { var s = b.Swatch(Color.FromArgb(r, g, bl)); s.NickName = name; return s; }
        var finishIdx = b.IndexOf(finish, "Finish index", "Powder Coat", "Anodised", "Brass", "Chrome");
        var metal = b.Lookup(finishIdx, "I", "Metalness", "0", "1", "1", "1");
        var rough = b.Lookup(finishIdx, "I", "Roughness", "0.42", "0.38", "0.3", "0.08");
        var coat = b.Lookup(finishIdx, "I", "Clearcoat", "0.45", "0", "0", "0");
        var paintIdx = b.IndexOf(bodyColour, "Colour index", "Forest", "Oxide", "Cream", "Graphite", "Ocean", "Custom");
        var paints = b.MergeAll("Paints", false, Sw("Forest", 30, 62, 54), Sw("Oxide", 148, 58, 40), Sw("Cream", 236, 228, 208),
            Sw("Graphite", 44, 46, 50), Sw("Ocean", 28, 70, 104), customColour);
        var paint = b.ListItem(List: paints, Index: paintIdx, nick: "Paint");
        var bodyColor = b.StreamFilter(Gate: finishIdx, Stream0: paint, Stream1: Sw("Anodised", 182, 186, 192), inputs: 5, nick: "Body colour");
        b.Feed(bodyColor.Obj, 3, Sw("Brass", 198, 158, 92)); b.Feed(bodyColor.Obj, 4, Sw("Chrome", 232, 234, 238));
        var liningIdx = b.IndexOf(lining, "Lining index", "White", "Cream", "Gold");
        var liningColor = b.ListItem(List: b.MergeAll("Linings", false, Sw("White", 250, 248, 242), Sw("Cream", 236, 228, 208), Sw("Gold", 214, 170, 96)),
            Index: liningIdx, nick: "Lining colour");
        var cableIdx = b.IndexOf(cableColour, "Cable index", "Black", "Copper", "White");
        var cableColor = b.ListItem(List: b.MergeAll("Cables", false, Sw("Black", 22, 22, 24), Sw("Copper", 176, 92, 58), Sw("White", 250, 248, 242)),
            Index: cableIdx, nick: "Cable colour");
        b.Section("Finish values", nLook);

        // ---- Materials and the 3D view
        var nView = b.Note("3D VIEW\nOne Display per part, each on its own layer. The light source and diffuser are emissive: switch the viewer to Night. " +
                           "Off, the source keeps its material at strength 0, so the Display never empties.", w: 460);
        var bodyMat = b.ThreeMaterial(Color: bodyColor, Metalness: metal, Roughness: rough, Clearcoat: coat, ClearcoatRoughness: 0.25, nick: "Body");
        var innerMat = b.ThreeMaterial(Color: liningColor, Metalness: 0.0, Roughness: 0.5, nick: "Lining");
        // Transmission makes it glass, which casts no shadow: an opaque or merely transparent cover would block the bulb.
        var frosted = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(250, 250, 246)), Metalness: 0.0, Roughness: 0.45, Transmission: 1.0, nick: "Frosted glass");
        var warm = b.Swatch(Color.FromArgb(255, 232, 196));
        var glassMat = b.EmissiveMaterial(Color: warm, Strength: b.Ev("x/160*0.3", "Diffuser glow", L("Lumens")), Base: frosted, Kelvin: kelvin, nick: "Diffuser glow");
        var bulbBase = b.ThreeMaterial(Color: b.Swatch(Color.FromArgb(255, 250, 236)), Metalness: 0.0, Roughness: 0.25, nick: "Bulb");
        var lightMat = b.EmissiveMaterial(Color: warm, Strength: b.Ev("if(x>0,4,0)", "Glow strength", L("Lumens")), Base: bulbBase,
            Kelvin: kelvin, Lumens: L("Lumens"), nick: "Light");
        var cableMat = b.ThreeMaterial(Color: cableColor, Metalness: 0.0, Roughness: 0.6, nick: "Cable");
        var deskIdx = b.IndexOf(desk, "Desk index", "Oak", "Walnut", "Maple", "Wenge");
        var deskMat = b.MaterialPreset(Preset: b.Lookup(deskIdx, "I", "Desk preset", PresetText("Oak, oiled"), PresetText("Walnut"), PresetText("Maple, lacquered"), PresetText("Wenge, oiled")), nick: "Desk top");
        var shows = new[]
        {
            b.Display(Geo: L("Body"), Name: "Body", Layer: "Lamp/Body", Material: bodyMat, nick: "Body"),
            b.Display(Geo: L("Inner"), Name: "Inner", Layer: "Lamp/Shade lining", Material: innerMat, nick: "Lining"),
            b.Display(Geo: L("Glass"), Name: "Diffuser", Layer: "Lamp/Diffuser", Material: glassMat, nick: "Diffuser"),
            b.Display(Geo: L("Light"), Name: "Light source", Layer: "Lamp/Light", Material: lightMat, nick: "Light source"),
            b.Display(Geo: L("Cable"), Name: "Cable", Layer: "Lamp/Cable", Material: cableMat, nick: "Cable"),
            b.Display(Geo: L("Desk"), Name: "Desk", Layer: "Context/Desk", Material: deskMat, nick: "Desk"),
        };
        var combine = b.CombineDisplay(nick: "Lamp");
        foreach (var s in shows) b.Feed(combine.Obj, 0, s);
        var oModel = b.Output("Lamp", combine.Obj);
        b.Section("3D view", nView);

        // ---- Light on the desk
        var nLux = b.Note("LIGHT ON THE DESK\nA second script follows the beam from the light source to the desk: illuminance along the lamp's " +
                          "centre line, its peak and how much of the desk gets 500 lx. Source: LampLight.script.cs.", w: 460);
        var lux = Script(b, "Light on the desk", "LampLight.script.cs",
            new (string, object)[] { ("Beam", L("Beam")), ("Lumens", L("Lumens")), ("Spread", L("Spread")), ("Cutoff", L("Cutoff")), ("Efficiency", L("Efficiency")), ("*Desk", L("Desk")) },
            "LuxX", "LuxY", "BrightEnough", "TaskLight", "Peak", "LitWidth");
        GhOut Lx(string output) => H.Out(lux, output);
        var deskSpan = b.DeconstructDomain(Domain: b.Bounds(Numbers: Lx("LuxX")), nick: "Desk span");
        var luxLine = b.Scatter2D(X: Lx("LuxX"), Y: Lx("LuxY"), Name: "Illuminance", Mode: 1, Color: b.Swatch(Color.FromArgb(232, 160, 60)), nick: "Illuminance");
        var target = b.Scatter2D(X: b.Merge(Data1: deskSpan.Start, Data2: deskSpan.End, nick: "Target x"), Y: b.Panel("500\n500", name: "Target lx", h: 40),
            Name: "500 lx task target", Mode: 1, Color: b.Swatch(Color.FromArgb(120, 120, 120)), nick: "Task target");
        var luxFigure = b.Figure(Traces: b.Merge(Data1: luxLine, Data2: target, nick: "Light traces"),
            Layout: b.Layout(Title: "Light on the desk", XAxis: "Distance from the base (mm)", YAxis: "Illuminance (lx)"), nick: "Light chart");
        var oLux = b.Output("Light on the desk", luxFigure.Obj);
        b.Section("Light on the desk", nLux, lux);

        // ---- Checks
        var nChecks = b.Note("CHECKS\nMessage components report in the page: a warning when the lamp tips over, remarks when a bare bulb " +
                             "will glare or the desk gets under 500 lx.");
        var tips = b.Warning("Tips over", L("Steady"), "The lamp tips over: widen the base, weight it, or shorten the reach.");
        IGH_DocumentObject Remark(string nick, GhOut ok, string text)
        {
            var m = b.Add(Message, nick: nick);
            b.Feed(m, 0, ok);
            b.Set(m, "M", text); b.Set(m, "L", 0); b.Set(m, "N", 1);
            return m;
        }
        var glare = Remark("Glare", L("GlareFree"), "The bare bulb stands out of the shade and will glare: add the diffuser, or pick a shorter light source.");
        var dim = Remark("Dim desk", Lx("BrightEnough"), "Under 500 lx on the desk: pick a brighter light source, or lower the head.");
        b.Section("Checks", nChecks);

        // ---- Price
        var nPrice = b.Note("PRICE\nThe parts at list price, times the finish's factor, less a quantity break: 10% from 10 lamps, 18% from 50. " +
                            "The donut shows one lamp at list price.", w: 460);
        var factor = b.Lookup(finishIdx, "I", "Finish factor", "1", "1.2", "1.65", "1.45");
        var partsSum = b.MassAddition(Input: L("PartEur"), nick: "Parts total");
        var premium = b.Ev("x*(y-1)", "Finish premium", partsSum.Result, factor);
        var listPrice = b.Ev("x*y", "List price", partsSum.Result, factor);
        var discount = b.Ev("if(x>=50,0.18,if(x>=10,0.1,0))", "Quantity break", quantity);
        var unit = b.Ev("Round(x*(1-y))", "Unit price", listPrice, discount);
        var total = b.Ev("x*y", "Order total", unit, quantity);
        var pie = b.PieChart(Values: Flatten(b.MergeAll("Slice values", true, L("PartEur"), premium)),
            Labels: Flatten(b.MergeAll("Slice labels", true, L("PartNames"), b.Panel("Finish", name: "Finish label"))), Hole: true, nick: "Price slices");
        var priceFigure = b.Figure(Traces: pie, Layout: b.Layout(Title: "One lamp at list price (EUR)"), nick: "Price chart");
        var oPrice = b.Output("Price breakdown", priceFigure.Obj);
        b.Section("Price", nPrice);

        // ---- Results
        var nResults = b.Note("RESULTS\nOne Context Print per value. The labels are what the page shows.");
        var spec = b.Format(Format: "{0} base, {1} arm, {2} head, {3}", Data0: b.ChoiceText(baseType), Data1: b.ChoiceText(arm), inputs: 6, nick: "Configuration");
        b.Feed(spec.Obj, 4, b.ChoiceText(head)); b.Feed(spec.Obj, 5, b.ChoiceText(finish));
        var prints = new[]
        {
            b.Print("Task light", lux, "TaskLight"),
            b.Print("Peak illuminance (lx)", lux, "Peak"),
            b.Print("Well-lit width (mm)", lux, "LitWidth"),
            b.Print("Power (W)", lamp, "PowerW"),
            b.Print("Stability", lamp, "Stability"),
            b.Print("Weight (kg)", lamp, "WeightKg"),
            b.Print("Configuration", spec.Obj),
            b.Print("Unit price (EUR)", unit.Obj),
            b.Print("Order total (EUR)", total.Obj),
        };
        b.Section("Results", nResults);

        var pdf = LampSheet(b, new LampSheetData(baseType, baseSize, deskT, height, reach, head, headSize, barLength, project, quantity, kelvin,
            L, Lx, spec, b.ChoiceText(finish), b.ChoiceText(bodyColour), finishIdx, premium, listPrice, discount, unit, total));

        // ---- Downloads
        var nFiles = b.Note("DOWNLOADS\nThe model takes its layers and colours from the 3D view through Deconstruct Display, but the script's own meshes: " +
                            "the view's come back triangulated and write four times slower. The parts list is priced for the order.", w: 460);
        var parts3d = b.DeconstructDisplay(WebDisplay: combine, nick: "Model parts");
        var lampParts = b.MergeAll("Lamp parts", true, L("Body"), L("Inner"), L("Glass"), L("Light"), L("Cable"), L("Desk"));
        var model = b.GeometryToFile(Geometry: Flatten(lampParts), LayerNames: Flatten(parts3d.Layers), LayerColors: Flatten(parts3d.Colors),
            FileNames: "studio-task-lamp", FileEnding: ".3dm", nick: "Model");
        var o3dm = b.Output("Model (3DM)", model.Obj);
        var netEur = b.Ev("x*(1-y)", "Net part price", L("PartEur"), discount);
        var partRows = b.Format(Format: "{0},\"{1}\",{2},{3:0.00},{4:0.00}", Data0: L("PartNames"), Data1: L("PartNotes"), inputs: 7, nick: "Part rows");
        b.Feed(partRows.Obj, 4, quantity); b.Feed(partRows.Obj, 5, netEur); b.Feed(partRows.Obj, 6, b.Ev("x*y", "Net line total", netEur, quantity));
        var netPremium = b.Ev("x*(1-y)", "Net finish premium", premium, discount);
        var closing = b.Format(Format: "Finish,\"{0}\",{1},{2:0.00},{3:0.00}\nTotal,,{1},{4:0.00},{5:0.00}", Data0: b.ChoiceText(finish), Data1: quantity, inputs: 8, nick: "Closing rows");
        b.Feed(closing.Obj, 4, netPremium); b.Feed(closing.Obj, 5, b.Ev("x*y", "Net finish total", netPremium, quantity)); b.Feed(closing.Obj, 6, unit); b.Feed(closing.Obj, 7, total);
        var csvLines = b.MergeAll("CSV lines", true, b.Panel("Part,Description,Qty,Unit price (EUR),Line total (EUR)", name: "CSV header"), partRows, closing);
        var csv = b.CreateFile(Data: csvLines, Name: "studio-task-lamp-parts", Extension: ".csv", IsBase64: false, nick: "Parts list");
        var oCsv = b.Output("Parts list (CSV)", csv.Obj);
        b.Section("Downloads", nFiles);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(LampForm());
        return new() { (lamp, "SourceOptions"), (lamp, "Lumens"), (lamp, "PartEur"), (lux, "Peak"), (unit.Obj, null), (bodyColor.Obj, null),
            (setSource.Obj, null), (combine.Obj, null), (luxFigure.Obj, null), (priceFigure.Obj, null), (pdf, null), (parts3d.Obj, 2), (model.Obj, null), (csv.Obj, null) };
    }



    /// <summary>What the spec sheet draws and tabulates.</summary>
    record LampSheetData(
        IGH_DocumentObject Base, IGH_DocumentObject BaseSize, IGH_DocumentObject DeskThickness, IGH_DocumentObject Height, IGH_DocumentObject Reach,
        IGH_DocumentObject Head, IGH_DocumentObject HeadSize, IGH_DocumentObject BarLength, IGH_DocumentObject Project, IGH_DocumentObject Quantity,
        IGH_DocumentObject Kelvin, Func<string, GhOut> Lamp, Func<string, GhOut> Lux, GhFormat Spec, IGH_DocumentObject FinishText,
        IGH_DocumentObject ColourText, IGH_DocumentObject FinishIndex, GhNode Premium, GhNode ListPrice, GhNode Discount, GhNode Unit, GhNode Total);

    // ============================================================================
    // Spec sheet: elevation, plan and specification on A3, parts and price on a second sheet
    // ============================================================================

    static IGH_DocumentObject LampSheet(B b, LampSheetData d)
    {
        var nViews = b.Note("DRAWING VIEWS\nA third script turns the lamp's meshes into an elevation and a plan: each part's silhouette, the light " +
                            "source as hidden lines, dimensions, and the scale each view needs. Source: LampViews.script.cs.", w: 460);
        var views = Script(b, "Drawing views", "LampViews.script.cs",
            new (string, object)[]
            {
                ("*Body", d.Lamp("Body")), ("*Light", d.Lamp("Light")), ("*Cable", d.Lamp("Cable")), ("Base", d.Base), ("BaseSize", d.BaseSize),
                ("DeskThickness", d.DeskThickness), ("Height", d.Height), ("Reach", d.Reach), ("Head", d.Head), ("HeadSize", d.HeadSize), ("BarLength", d.BarLength),
            },
            "ElevScaleNeed", "PlanScaleNeed", "ElevSize", "PlanSize",
            "ElevLines", "ElevHidden", "ElevDesk", "ElevDimA", "ElevDimB", "ElevDimLabel",
            "PlanLines", "PlanHidden", "PlanDimA", "PlanDimB", "PlanDimLabel");
        GhOut V(string output) => H.Out(views, output);
        b.Section("Drawing views", nViews, views);

        var nScale = b.Note("SHEET SCALE\nEach view takes the next of 1:5, 1:10 and 1:20 that fits. The title block says 'As shown' when they differ.");
        var elevDen = b.StandardScale(V("ElevScaleNeed"), 5, 10, 20);
        var planDen = b.StandardScale(V("PlanScaleNeed"), 5, 10, 20);
        var elevScale = b.Format(Format: "1:{0}", Data0: elevDen, nick: "Elevation scale");
        var planScale = b.Format(Format: "1:{0}", Data0: planDen, nick: "Plan scale");
        var sameScale = b.Equality(elevDen, planDen, nick: "Same scale?");
        var sheetScale = b.StreamFilter(Gate: sameScale.Equality, Stream0: "As shown", Stream1: elevScale, nick: "Sheet scale");
        var elevLen = b.Ev("x/y", "Elevation length (mm)", V("ElevSize"), elevDen);
        var planLen = b.Ev("x/y", "Plan length (mm)", V("PlanSize"), planDen);
        var visible = b.PathStyle(StrokeWidth: 0.25, nick: "Visible");
        var hidden = b.PathStyle(StrokeColor: b.Swatch(Color.FromArgb(110, 110, 110)), StrokeWidth: 0.13, DashPattern: new object[] { 1.5, 0.8 }, nick: "Hidden");
        var section = b.PathStyle(StrokeWidth: 0.35, FillColor: b.Swatch(Color.FromArgb(232, 222, 204)), Fill: true, nick: "Desk section");
        var titleStyle = b.TextStyle(FontSize: 4.0, Weight: 1, nick: "View title");
        var cellStyle = b.TextStyle(FontSize: 3.0, nick: "Table text");
        b.Section("Sheet scale and styles", nScale);

        var nElev = b.Note("ELEVATION\nThe parts, the light source dashed inside the shade, the desk in section with break lines, height and reach.");
        var elevDims = b.LinearDimension(PointA: V("ElevDimA"), PointB: V("ElevDimB"), Offset: 8.0, Label: V("ElevDimLabel"), TextSize: 3.0, nick: "Elevation dimensions");
        var elev = b.ScaledView("Elevation view", elevLen, b.Draw(V("ElevDesk"), section, "Draw desk"), b.Draw(V("ElevLines"), visible, "Draw elevation"),
            b.Draw(V("ElevHidden"), hidden, "Draw elevation hidden"), elevDims);
        b.Section("Elevation", nElev);

        var nPlan = b.Note("PLAN\nThe lamp from above, the light source dashed under the shade, with the base and head sizes.");
        var planDims = b.LinearDimension(PointA: V("PlanDimA"), PointB: V("PlanDimB"), Offset: -8.0, Label: V("PlanDimLabel"), TextSize: 3.0, nick: "Plan dimensions");
        var plan = b.ScaledView("Plan view", planLen, b.Draw(V("PlanLines"), visible, "Draw plan"), b.Draw(V("PlanHidden"), hidden, "Draw plan hidden"), planDims);
        b.Section("Plan", nPlan);

        // ---- Sheet 1
        var nSheet = b.Note("SHEET 1\nElevation left, plan and specification right, notes and title block in the footer. The table's rows are one " +
                            "Format, split into lines and then at each ';' into cells.", w: 460);
        var isPowder = b.Equality(d.FinishIndex, 0.0, nick: "Powder coat?");
        var finishText = b.StreamFilter(Gate: isPowder.Equality, Stream0: d.FinishText, Stream1: b.Format(Format: "Powder coat, {0}", Data0: d.ColourText, nick: "Paint text"), nick: "Finish text");
        var specText = b.Format(Format: "Configuration;{0}\nFinish;{1}\nLight source;{2}\nPower;{3} W\nColour temperature;{4} K\n" +
                                        "Light on the desk;{5:#,0} lx peak, 500 lx over {6:0} mm\nStability;{7}\nWeight;{8:0.00} kg\n" +
                                        "Unit price;EUR {9:#,0}, quantity break {12:0}%\nOrder;{10} x EUR {9:#,0} = EUR {11:#,0}",
            Data0: d.Spec, Data1: finishText, inputs: 15, nick: "Specification text");
        object[] specData = { d.Lamp("SourceName"), d.Lamp("PowerW"), d.Kelvin, d.Lux("Peak"), d.Lux("LitWidth"), d.Lamp("Stability"), d.Lamp("WeightKg"),
            d.Unit, d.Quantity, d.Total, b.Ev("x*100", "Break (%)", d.Discount) };
        for (var i = 0; i < specData.Length; i++) b.Feed(specText.Obj, 4 + i, specData[i]);
        var table = b.Table(Rows: Cells(b, "Specification", specText), ColumnWidths: new object[] { 44.0, 136.0 }, DefaultStyle: cellStyle,
            ColumnAlign: new object[] { "l", "l" }, BorderStyle: 1, nick: "Specification");
        var left = b.Stack(Drawings: b.MergeAll("Left column", true, elev, b.Caption("ELEVATION", elevScale, titleStyle)), Orientation: 0, Spacing: 4.0, nick: "Left column");
        var right = b.Stack(Drawings: b.MergeAll("Right column", true, plan, b.Caption("PLAN", planScale, titleStyle), b.Caption("SPECIFICATION", null, titleStyle), table.Drawing),
            Orientation: 0, Spacing: 4.0, nick: "Right column");
        var body = b.Stack(Drawings: b.MergeAll("Columns", true, left, right), Orientation: 1, Spacing: 16.0, CrossAlign: 0, nick: "Sheet body");
        var notes = b.Panel("NOTES\n1. Dimensions in millimetres, from the desk top.\n2. Light figures model the shade as a cosine beam inside its cut-off: a guide, not a photometric test.\n" +
                            "3. Drawn by Selva from the model: change an input and the sheet redraws.", name: "Notes text", w: 300, h: 80, multiItem: false);
        var notesBlock = b.TextFlow(Text: notes, Width: 170.0, Style: cellStyle, nick: "Notes");
        var title = b.TitleBlock(Project: d.Project, Owner: "Selva showcase", Title: "Studio task lamp: specification", DrawingNo: "STL-100", Revision: "A",
            Scale: sheetScale, Sheet: "{page}/{pages}", Date: "{date:dd.MM.yyyy}", CreatedBy: "Selva", Width: 170.0, nick: "Title block");
        var page = b.Page(Drawings: body, Title: "Specification", Override: b.Footer("Sheet footer", notesBlock.Drawing, title.Drawing), KeepTogether: true, nick: "Sheet 1");
        b.Section("Sheet 1", nSheet);

        // ---- Sheet 2
        var nParts = b.Note("SHEET 2: PARTS AND PRICE\nOne row per part from the script, then the finish, list price, quantity break and totals, " +
                            "under a slim continuation title strip.", w: 460);
        var partLines = b.Format(Format: "{0};{1};{2:0.00}", Data0: d.Lamp("PartNames"), Data1: d.Lamp("PartNotes"), inputs: 5, nick: "Part lines");
        b.Feed(partLines.Obj, 4, d.Lamp("PartEur"));
        var totalLines = b.Format(Format: "Finish;{0};{1:0.00}\nList price;One lamp;{2:0.00}\nQuantity break;{3:0}% at {4} pcs;-{5:0.00}\n" +
                                          "Unit price;Rounded to the euro;{6:0.00}\nOrder total;{4} x unit price;{7:#,0.00}",
            Data0: d.FinishText, Data1: d.Premium, inputs: 10, nick: "Total lines");
        object[] totalData = { d.ListPrice, b.Ev("x*100", "Break % ", d.Discount), d.Quantity, b.Ev("x*y", "Break (EUR)", d.ListPrice, d.Discount), d.Unit, d.Total };
        for (var i = 0; i < totalData.Length; i++) b.Feed(totalLines.Obj, 4 + i, totalData[i]);
        var parts = b.Table(Headers: new object[] { "Part", "Description", "EUR" }, Rows: Cells(b, "Parts", partLines, totalLines),
            ColumnWidths: new object[] { 44.0, 150.0, 30.0 }, DefaultStyle: cellStyle, ColumnAlign: new object[] { "l", "l", "r" }, BorderStyle: 1, nick: "Parts table");
        var strip = b.TitleBlock(Variant: 1, Project: d.Project, Title: "Studio task lamp: parts and price", DrawingNo: "STL-101", Revision: "A",
            Scale: "-", Sheet: "{page}/{pages}", Date: "{date:dd.MM.yyyy}", Width: 170.0, nick: "Title strip");
        var partsBody = b.Stack(Drawings: b.MergeAll("Sheet 2 parts", true, b.Caption("PARTS AND PRICE", null, titleStyle), parts.Drawing), Orientation: 0, Spacing: 4.0, nick: "Sheet 2 body");
        var page2 = b.Page(Drawings: partsBody, Title: "Parts and price", Override: b.Footer("Sheet 2 footer", strip.Drawing), KeepTogether: true, nick: "Sheet 2");
        b.Section("Sheet 2", nParts);

        var nDoc = b.Note("DOCUMENT\nBoth sheets on A3 landscape with 12 mm margins, rendered to one PDF.");
        var paper = b.LayoutOverride(PaperSize: 3, Landscape: true, Margin: 12.0, Units: 1, nick: "A3 landscape");
        var doc = b.Document(Pages: b.Merge(Data1: page, Data2: page2, nick: "Pages"), Title: "Studio task lamp", Author: "Selva", Override: paper, nick: "Spec sheet");
        var pdf = b.RenderPDF(Document: doc, Name: "studio-task-lamp-spec", nick: "PDF");
        var oPdf = b.Output("Spec sheet (PDF)", pdf.Obj);
        b.Section("Document", nDoc);
        return pdf.Obj;
    }

    /// <summary>Table rows from text: each source's lines, each line split at ';' into one branch of cells.</summary>
    static GhOut Cells(B b, string nick, params object[] texts)
    {
        var lines = b.Add("Text Split", nick: nick + " lines");
        b.Feed(lines, 0, GhIn.Flatten(b.MergeAll(nick + " text", true, texts)));
        b.Set(lines, 1, "\n");
        var cells = b.Add("Text Split", nick: nick + " cells");
        b.Feed(cells, 0, GhIn.Flatten(new GhOut(lines, 0)));
        b.Set(cells, 1, ";");
        return new GhOut(cells, 0);
    }

    /// <summary>A C# Script whose source is <paramref name="file" /> beside this generator.</summary>
    static IGH_Component Script(B b, string nick, string file, (string Name, object From)[] inputs, params string[] outputs) =>
        b.Script(nick, File.ReadAllText(Path.Combine(Dir, LampFolder, file)), inputs, outputs);

    static string LampForm()
    {
        static string When(string action, params (string Param, string Value)[] rules) =>
            "'visibilityCondition': { 'mode': 'all', 'action': '" + action + "', 'rules': [ " +
            string.Join(", ", rules.Select(r => "{ 'param': '" + r.Param + "', 'operator': 'equals', 'value': '" + r.Value + "' }")) + " ] }";

        var assets = JObject.Parse(File.ReadAllText(Path.Combine(Dir, LampFolder, "lamp-assets.json")));
        void Asset(string key, JObject value) => assets[key] = value;
        Asset("ic-round", new JObject { ["d"] = "M3 15a9 3 0 0 0 18 0a9 3 0 0 0-18 0 M12 15V4" });
        Asset("ic-square", new JObject { ["d"] = "M3 13h18v4H3z M12 13V4" });
        Asset("ic-clamp", new JObject { ["d"] = "M3 11h12 M3 14h12 M15 8h4v12h-4 M17 8V3 M17 20v1" });
        Asset("th-custom", new JObject { ["img"] = Rainbow() });
        Asset("th-white", new JObject { ["img"] = H.Thumb(Color.FromArgb(250, 248, 242)) });
        Asset("th-gold", new JObject { ["img"] = H.Stripes(Color.FromArgb(214, 170, 96), Color.FromArgb(190, 148, 78)) });
        Asset("th-oak", new JObject { ["img"] = H.Stripes(Color.FromArgb(196, 156, 108), Color.FromArgb(176, 136, 90)) });
        Asset("th-walnut", new JObject { ["img"] = H.Stripes(Color.FromArgb(107, 71, 46), Color.FromArgb(88, 56, 36)) });
        Asset("th-maple", new JObject { ["img"] = H.Stripes(Color.FromArgb(232, 212, 178), Color.FromArgb(218, 196, 158)) });
        Asset("th-wenge", new JObject { ["img"] = H.Stripes(Color.FromArgb(62, 46, 38), Color.FromArgb(44, 32, 27)) });

        return Json(@"{
  'name': 'Studio Task Lamp',
  'description': 'Configure a desk lamp: base, arm, head, finish and light source. It checks stability and the light on the desk, prices the order, and draws a spec sheet.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e4e1da', 'look': 'showcase' },
  'assets': ASSETS,
  'tabs': [
    { 'label': 'Lamp', 'groups': [
      { 'label': 'Base', 'items': [
        { 'param': 'Base', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Round': { 'icon': 'ic-round' }, 'Square': { 'icon': 'ic-square' }, 'Clamp': { 'icon': 'ic-clamp' } } } },
        { 'param': 'Base size', 'label': 'Size (mm)', " + SliderConfig + ", " + When("hide", ("Base", "Clamp")) + @" },
        { 'param': 'Weighted base', 'label': 'Weighted', 'description': 'Thicker steel, for long reaches.', " + When("hide", ("Base", "Clamp")) + @" },
        { 'param': 'Desk thickness', 'label': 'Desk thickness (mm)', " + SliderConfig + ", " + ShowWhen("Base", "Clamp") + @" }
      ] },
      { 'label': 'Arm', 'items': [
        { 'param': 'Arm', 'label': 'Style', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } },
        { 'param': 'Height', 'label': 'Height (mm)', " + SliderConfig + @" },
        { 'param': 'Reach', 'label': 'Reach (mm)', " + SliderConfig + @" },
        { 'param': 'Elbow', 'label': 'Elbow position (%)', " + SliderConfig + ", " + ShowWhen("Arm", "Two-Joint") + @" }
      ] },
      { 'label': 'Head', 'items': [
        { 'param': 'Head', 'label': 'Shape', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Dome': { 'icon': 'ic-dome' }, 'Cone': { 'icon': 'ic-cone' }, 'Cylinder': { 'icon': 'ic-cylinder' }, 'Linear Bar': { 'icon': 'ic-linear-bar' } } } },
        { 'param': 'Head size', 'label': 'Diameter (mm)', " + SliderConfig + ", " + When("hide", ("Head", "Linear Bar")) + @" },
        { 'param': 'Bar length', 'label': 'Length (mm)', " + SliderConfig + ", " + ShowWhen("Head", "Linear Bar") + @" },
        { 'param': 'Head tilt', 'label': 'Tilt (deg)', " + SliderConfig + @" }
      ] }
    ] },
    { 'label': 'Finish', 'groups': [
      { 'label': 'Body', 'items': [
        { 'param': 'Finish', 'label': 'Material', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Powder Coat': { 'image': 'th-powder-coat' }, 'Anodised': { 'image': 'th-anodised' }, 'Brass': { 'image': 'th-brass' }, 'Chrome': { 'image': 'th-chrome' } } } },
        { 'param': 'Body colour', 'label': 'Colour', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Forest': { 'image': 'th-forest' }, 'Oxide': { 'image': 'th-oxide' }, 'Cream': { 'image': 'th-cream' }, 'Graphite': { 'image': 'th-graphite' },
            'Ocean': { 'image': 'th-ocean' }, 'Custom': { 'image': 'th-custom' } } }, " + ShowWhen("Finish", "Powder Coat") + @" },
        { 'param': 'Custom colour', " + When("show", ("Finish", "Powder Coat"), ("Body colour", "Custom")) + @" }
      ] },
      { 'label': 'Shade', 'items': [
        { 'param': 'Lining', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented', 'optionMedia': {
            'White': { 'image': 'th-white' }, 'Cream': { 'image': 'th-cream' }, 'Gold': { 'image': 'th-gold' } } }, " + When("hide", ("Head", "Linear Bar")) + @" },
        { 'param': 'Diffuser', 'label': 'Frosted diffuser', 'description': 'Softens the glare. Behind it the light source must fit inside the shade.', " + When("hide", ("Head", "Linear Bar")) + @" }
      ] },
      { 'label': 'Cable', 'items': [
        { 'param': 'Cable', 'label': 'Visible cable', 'description': 'Off for a battery version.' },
        { 'param': 'Cable colour', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' }, " + ShowWhen("Cable", true) + @" }
      ] }
    ] },
    { 'label': 'Light', 'groups': [
      { 'label': 'Light source', 'items': [
        { 'param': 'Light source options', 'widget': 'dynamicValueList' },
        { 'param': 'Light source', 'description': 'Only what fits the head. Try a bigger dome, or take the diffuser off.' },
        { 'param': 'Light on', 'description': 'Switch the viewer to Night: the lamp then lights the desk.' },
        { 'param': 'Colour temperature', 'label': 'Colour temperature (K)', " + SliderConfig + ", " + ShowWhen("Light on", true) + @" }
      ] },
      { 'label': 'Desk', 'items': [
        { 'param': 'Desk', 'label': 'Desk top', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Oak': { 'image': 'th-oak' }, 'Walnut': { 'image': 'th-walnut' }, 'Maple': { 'image': 'th-maple' }, 'Wenge': { 'image': 'th-wenge' } } } }
      ] }
    ] },
    { 'label': 'Order', 'groups': [
      { 'label': 'Order', 'items': [
        { 'param': 'Project', 'description': 'Printed in the spec sheet title block.' },
        { 'param': 'Quantity', 'description': '10% off from 10 lamps, 18% off from 50.', " + SliderConfig + @" }
      ] },
      { 'label': 'Price', 'items': [ 'Unit price (EUR)', 'Order total (EUR)', 'Price breakdown' ] }
    ] },
    { 'label': 'Results', 'groups': [
      { 'label': 'Light', 'items': [ 'Task light', 'Peak illuminance (lx)', 'Well-lit width (mm)', 'Power (W)', 'Light on the desk' ] },
      { 'label': 'Build', 'items': [ 'Stability', 'Weight (kg)', 'Configuration' ] },
      { 'label': 'Downloads', 'items': [ 'Spec sheet (PDF)', 'Model (3DM)', 'Parts list (CSV)' ] }
    ] }
  ]
}").Replace("ASSETS", assets.ToString(Newtonsoft.Json.Formatting.None));
    }

    /// <summary>A 48 px hue sweep as a PNG data URI: the Custom colour tile.</summary>
    static string Rainbow()
    {
        using var bmp = new Bitmap(48, 48);
        for (var x = 0; x < 48; x++)
        {
            var c = HueColor(x / 48.0 * 360);
            for (var y = 0; y < 48; y++) bmp.SetPixel(x, y, c);
        }
        using var ms = new MemoryStream();
        bmp.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
    }

    static Color HueColor(double h)
    {
        double f(double n) { var k = (n + h / 60) % 6; return 0.72 - 0.5 * Math.Max(0, Math.Min(Math.Min(k, 4 - k), 1)); }
        return Color.FromArgb((int)(255 * f(5)), (int)(255 * f(3)), (int)(255 * f(1)));
    }
}
