using Grasshopper.Kernel;
using System;
using System.Collections.Generic;
using System.Drawing;
using static SelvaBuilder;

public static partial class Definitions
{
    const string Display = "e4111712-6f0a-4f1b-950f-777eecaebe01";
    const string SetDynamicValueList = "1d8e3f62-7b4a-4c9e-a0f1-5c2d8e7b3a41";
    const string Figure = "74f7ec40-3543-4e56-a030-d42900723a23";
    const string RenderPdf = "7a284a84-2669-46b8-9fcb-46161d611689";
    const string DrawText = "6b9d20cc-5566-47cf-9364-f65f9283396f";
    const string Table = "2cf47ac1-c52e-4e86-8495-30b86969232b";
    const string Page = "aa5eaa20-2ad8-4ece-8da5-bb275bf36456";
    const string Document = "5d1cf967-d40d-412e-aa63-4d081419bdf3";

    // ============================================================================
    // Stress: display throughput
    // ============================================================================

    static List<(IGH_DocumentObject, object)> StressDisplay(B b)
    {
        b.Note("STRESS: DISPLAY THROUGHPUT\nFor developers. Scales objects, mesh density, groups and a text payload until the " +
               "viewer, the wire format or the transport gives way. Each geometry kind takes a different path: meshes go as they " +
               "are, breps are meshed by the plugin or Compute, curves and points have their own encoders.", w: 560);

        var nLoad = b.Note("LOAD\nObjects = grid size². Faces per mesh box = 6 × density². Groups = materials and layers.");
        var n = b.Number("Grid size", 1, 20, 200, 0);
        var density = b.Number("Mesh density", 1, 2, 40, 0);
        var groups = b.Number("Groups", 1, 8, 64, 0);
        var kind = b.Choice("Geometry", 0, "Meshes", "Breps", "Curves", "Points");
        var spread = b.Number("Height variation", 0, 0.5, 1, 2);
        var seed = b.Number("Seed", 0, 1, 100, 0);
        var payload = b.Number("Payload", 1, 1, 20000, 0);
        b.Section("Load", nLoad, n, density, groups, kind, spread, seed, payload);

        var nGeo = b.Note("GEOMETRY\nA grid of boxes with random heights, then the chosen kind of geometry from them.");
        var xs = b.Add("Series", nick: "Grid x"); b.Set(xs, "S", 0.0); b.Set(xs, "N", 1.2); b.W(n, xs, "C");
        var pts = b.Pt("Grid points", xs, xs, 0.0); b.Map(pts, "X", GH_DataMapping.Graft);
        var ptList = b.Add("Flatten Tree", nick: "Point list"); b.W(pts, ptList, 0);
        var placing = b.Add(Progress, nick: "Placing"); b.W(ptList, placing, "D"); b.Set(placing, "M", "Placing objects…");
        var count = b.Add("List Length", nick: "Object count"); b.W(ptList, count, 0);
        var lo = b.Expr("1-x*0.9", "Shortest", spread);
        var hi = b.Expr("1+x*3", "Tallest", spread);
        var range = b.Add("Construct Domain", nick: "Height range"); b.W(lo, range, "A"); b.W(hi, range, "B");
        var heights = b.Add("Random", nick: "Heights"); b.W(range, heights, "R"); b.W(count, heights, "N"); b.W(seed, heights, "S");
        var boxes = b.Add("Center Box", nick: "Boxes"); b.W(placing, boxes, "B"); b.Set(boxes, "X", 0.5); b.Set(boxes, "Y", 0.5); b.W(heights, boxes, "Z");
        var meshing = b.Add(Progress, nick: "Meshing"); b.W(boxes, meshing, "D"); b.Set(meshing, "M", "Meshing boxes…");
        var meshes = b.Add("Mesh Box", nick: "Meshes"); b.W(meshing, meshes, "B"); b.W(density, meshes, "X"); b.W(density, meshes, "Y"); b.W(density, meshes, "Z");
        var curves = b.Add(Rectangle, nick: "Curves"); b.W(placing, curves, "P"); b.Set(curves, "X", new Rhino.Geometry.Interval(-0.5, 0.5)); b.Set(curves, "Y", new Rhino.Geometry.Interval(-0.5, 0.5));
        var kindIdx = b.IndexOf(kind, "Kind index", "Meshes", "Breps", "Curves", "Points");
        var chosen = b.Add("Stream Filter", nick: "Chosen kind"); b.Inputs(chosen, 5);
        b.W(kindIdx, "I", chosen, 0); b.W(meshes, chosen, 1); b.W(boxes, chosen, 2); b.W(curves, "R", chosen, 3); b.W(placing, chosen, 4);
        b.Section("Geometry", nGeo, xs, pts, ptList, placing, count, lo, hi, range, heights, boxes, meshing, meshes, curves, kindIdx, chosen);

        var nGroups = b.Note("GROUPS\nThe objects split into equal groups, each with its own colour and layer: one Display branch per group.");
        var chunk = b.Expr("floor((x+y-1)/y)", "Group size", count, groups);
        var parts = b.Add("Partition List", nick: "Groups"); b.W(chosen, parts, "L"); b.W(chunk, parts, "S");
        var groupNo = b.Add("Series", nick: "Group numbers"); b.Set(groupNo, "S", 0.0); b.Set(groupNo, "N", 1.0); b.W(groups, groupNo, "C");
        var gradient = b.Add("Gradient", nick: "Group colours"); ((Grasshopper.Kernel.Special.GH_GradientControl)gradient).Gradient = Grasshopper.GUI.Gradient.GH_Gradient.Spectrum(); b.Set(gradient, "L0", 0.0); b.W(groups, gradient, "L1"); b.W(groupNo, gradient, "t");
        var mats = b.Add(ThreeMaterial, nick: "Group materials"); b.W(gradient, mats, "C"); b.Set(mats, "R", 0.6);
        var matTree = b.Add("Graft Tree", nick: "Material per group"); b.W(mats, matTree, 0);
        var layers = b.Add("Format", nick: "Layer names"); b.Set(layers, "F", "Stress/Group {0:00}"); b.W(groupNo, layers, 2);
        var layerTree = b.Add("Graft Tree", nick: "Layer per group"); b.W(layers, layerTree, 0);
        var show = b.Add(Display, nick: "Scene"); b.W(parts, show, "G"); b.Set(show, "N", "Object"); b.W(layerTree, show, "L"); b.W(matTree, show, "M");
        var oScene = b.Output("Scene", show);
        b.Section("Groups", nGroups, chunk, parts, groupNo, gradient, mats, matTree, layers, layerTree, show, oScene);

        var nNum = b.Note("NUMBERS\nWhat the viewer is about to receive, and a warning past two million faces.");
        var faces = b.Expr("x*6*y^2", "Faces", count, density);
        var verts = b.Expr("x*6*(y+1)^2", "Vertices", count, density);
        var light = b.Add("Smaller Than", nick: "Under 2 M?"); b.W(faces, light, "A"); b.Set(light, "B", 2e6);
        var warn = b.Add(Message, nick: "Heavy scene");
        b.W(light, "<", warn, "C"); b.Set(warn, "M", "Over two million faces: expect a slow first frame, and a struggling phone."); b.Set(warn, "L", 1); b.Set(warn, "N", 1);
        var pObjects = b.Print("Objects", count);
        var pFaces = b.Print("Mesh faces", b.Fmt("{0:0}", faces));
        var pVerts = b.Print("Mesh vertices", b.Fmt("{0:0}", verts));
        b.Section("Numbers", nNum, faces, verts, light, warn, pObjects, pFaces, pVerts);

        var nPay = b.Note("PAYLOAD\nA text file of the chosen size in kB, to push the file transport and the download path.");
        var line = b.Panel(new string('x', 1023), name: "1 kB line", w: 200);
        var lines = b.Add("Repeat Data", nick: "Lines"); b.W(line, lines, "D"); b.W(payload, lines, "L");
        var file = b.Add(CreateFile, nick: "Payload file"); b.W(lines, file, "D"); b.Set(file, "N", "payload"); b.Set(file, "Ext", ".txt"); b.Set(file, "B64", false);
        var oFile = b.Output("Payload (TXT)", file);
        b.Section("Payload", nPay, line, lines, file, oFile);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(Json(@"{
  'name': 'Stress: Display Throughput',
  'description': 'For developers: scale objects, mesh density, groups and a file payload until something gives way.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'look': 'technical' },
  'tabs': [
    { 'label': 'Load', 'groups': [
      { 'label': 'Scene', 'items': [
        { 'param': 'Geometry', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } },
        { 'param': 'Grid size', 'description': 'Objects = grid size squared, up to 40,000.', " + SliderConfig + @" },
        { 'param': 'Mesh density', 'description': 'Faces per box = 6 × density². Meshes only.', " + SliderConfig + @",
          'visibilityCondition': { 'mode': 'all', 'action': 'show', 'rules': [ { 'param': 'Geometry', 'operator': 'equals', 'value': 'Meshes' } ] } },
        { 'param': 'Groups', 'description': 'Materials and layers.', " + SliderConfig + @" },
        { 'param': 'Height variation', " + SliderConfig + @" },
        { 'param': 'Seed', " + SliderConfig + @" }
      ] },
      { 'label': 'Files', 'items': [
        { 'param': 'Payload', 'label': 'Payload (kB)', " + SliderConfig + @" }
      ] }
    ] },
    { 'label': 'Results', 'groups': [
      { 'label': 'Counts', 'items': [ 'Objects', 'Mesh faces', 'Mesh vertices' ] },
      { 'label': 'Files', 'items': [ 'Payload (TXT)' ] }
    ] }
  ]
}"));
        return new() { (ptList, null), (boxes, null), (meshes, null), (chosen, null), (parts, null), (mats, null), (show, null), (faces, null), (file, null) };
    }

    // ============================================================================
    // Stress: every input and output
    // ============================================================================

    static List<(IGH_DocumentObject, object)> KitchenSink(B b)
    {
        b.Note("STRESS: EVERY INPUT AND OUTPUT\nFor developers. One of each input widget, visibility rules, a dynamic value list, " +
               "every output kind (text, numbers, 3D, charts, files, a folder of files), progress steps, and remarks, warnings " +
               "and errors on demand. The Echo output shows exactly what the definition received.", w: 560);

        // ---- Inputs
        var nIn = b.Note("BASIC INPUTS\nNumber, integer, boolean and text.");
        var number = b.Number("Number", 0, 42.5, 100, 2);
        var integer = b.Number("Integer", 1, 5, 20, 0);
        var flag = b.Switch("Boolean", false);
        var text = b.Text("Text", "Hello, Selva");
        var advanced = b.Number("Advanced", 0, 3, 10, 1);
        b.Section("Basic inputs", nIn, number, integer, flag, text, advanced);

        var nCh = b.Note("CHOICES\nThree value-list styles and a dynamic list whose options come from Integer.");
        var dropdown = b.Choice("Dropdown", 0, "Alpha", "Beta", "Gamma");
        var segmented = b.Choice("Segmented", 1, "S", "M", "L", "XL");
        var tiles = b.Choice("Tiles", 2, "Red", "Green", "Blue");
        var gammaNote = b.Text("Gamma note", "Only shown for Gamma");
        var dynamic = b.Add(SelvaBuilder.GetDynamicValueList, nick: "Dynamic");
        dynamic.GetType().GetProperty("Prompt")?.SetValue(dynamic, "Dynamic");
        b.Section("Choices", nCh, dropdown, segmented, tiles, gammaNote, dynamic);

        var nMedia = b.Note("MEDIA\nColour tints the box; an image becomes its texture; a file's name and size are echoed.");
        var colour = b.Colour("Colour", Color.FromArgb(230, 120, 40));
        var file = b.Add(SelvaBuilder.GetFile, nick: "File"); ((IGH_Param)file).Optional = true;
        var image = b.Add(SelvaBuilder.GetImage, nick: "Image"); ((IGH_Param)image).Optional = true;
        var raise = b.Choice("Raise", 0, "Nothing", "Remark", "Warning", "Error");
        b.Section("Media and messages", nMedia, colour, file, image, raise);

        // ---- Dynamic value list: options from Integer
        var nDyn = b.Note("DYNAMIC OPTIONS\nInteger sets how many options the Dynamic list offers.");
        var optNo = b.Add("Series", nick: "Option numbers"); b.Set(optNo, "S", 1.0); b.Set(optNo, "N", 1.0); b.W(integer, optNo, "C");
        var optText = b.Add("Format", nick: "Option pairs"); b.Set(optText, "F", "\"Option {0}\" = {0}"); b.W(optNo, optText, 2);
        var setDvl = b.Add(SetDynamicValueList, nick: "Dynamic options"); b.W(optText, setDvl, 0);
        setDvl.GetType().GetProperty("TargetInputId").SetValue(setDvl, dynamic.InstanceGuid);
        var oDvl = b.Output("Dynamic options", setDvl);
        b.Section("Dynamic options", nDyn, optNo, optText, setDvl, oDvl);

        // ---- Echo
        var nEcho = b.Note("ECHO\nEvery value as the definition received it, one line each, plus a long text to test wrapping.");
        var echo = b.Add("Format", nick: "Echo"); b.Inputs(echo, 13);
        b.Set(echo, "F", "number = {0}\ninteger = {1}\nboolean = {2}\ntext = {3}\nadvanced = {4}\ndropdown = {5}\nsegmented = {6}\ntiles = {7}\ndynamic = {8}\ncolour = {9}\nfile = {10}");
        var sources = new IGH_DocumentObject[] { number, integer, flag, text, advanced, b.ChoiceText(dropdown), b.ChoiceText(segmented), b.ChoiceText(tiles), dynamic, colour, file };
        for (var i = 0; i < sources.Length; i++) b.W(sources[i], echo, i + 2);
        var pEcho = b.Print("Echo", echo);
        var longText = b.Add("Repeat Data", nick: "Long text"); b.W(b.Panel("Selva wraps long outputs without breaking the layout. ", name: "Sentence", w: 300), longText, "D"); b.Set(longText, "L", 40);
        var joined = b.Add("Text Join", nick: "Paragraph"); b.W(longText, joined, "T"); b.Set(joined, "J", "");
        var pLong = b.Print("Long text", joined);
        var pNumber = b.Print("Number × 2", b.Expr("x*2", "Double", number));
        b.Section("Echo", nEcho, echo, pEcho, longText, joined, pLong, pNumber);

        // ---- 3D
        var nGeo = b.Note("3D\nA box per Integer, coloured by Colour and textured with Image when one is given.");
        var xs = b.Add("Series", nick: "Box x"); b.Set(xs, "S", 0.0); b.Set(xs, "N", 1.5); b.W(integer, xs, "C");
        var centres = b.Pt("Box centres", xs, 0.0, 0.5);
        var boxes = b.Add("Center Box", nick: "Boxes"); b.W(centres, boxes, "B"); b.Set(boxes, "X", 0.5); b.Set(boxes, "Y", 0.5); b.W(b.Expr("x/20+0.1", "Box half height", number), boxes, "Z");
        var mesh = b.Add("Mesh Box", nick: "Box meshes"); b.W(boxes, mesh, "B"); b.Set(mesh, "X", 1); b.Set(mesh, "Y", 1); b.Set(mesh, "Z", 1);
        var mat = b.Add(ThreeMaterial, nick: "Box material"); b.W(colour, mat, "C"); b.W(image, mat, "TX"); b.Set(mat, "R", 0.4);
        var show = b.Show("Boxes", "Kitchen sink", mesh, mat);
        var oScene = b.Output("Scene", show);
        b.Section("3D", nGeo, xs, centres, boxes, mesh, mat, show, oScene);

        // ---- Charts
        var nCharts = b.Note("CHARTS\nA bar chart, a scatter and a histogram from the same numbers.");
        var series = b.Add("Range", nick: "t"); b.Set(series, "N", 60); b.Set(series, "D", new Rhino.Geometry.Interval(0, 6.283));
        var wave = b.Expr("sin(x*y/10)", "Wave", series, number);
        var waveChart = b.Add(QuickChart, nick: "Wave chart"); b.W(wave, waveChart, "D"); b.Set(waveChart, "T", "sin(t × Number / 10)");
        var bars = b.Add("872d29c3-a5c9-4295-982f-f098a1b57332", nick: "Bars");
        b.W(b.Panel("Alpha\nBeta\nGamma", name: "Bar labels", h: 60), bars, "X"); b.W(b.Panel("3\n7\n5", name: "Bar values", h: 60), bars, "Y"); b.Set(bars, "N", "Choices");
        var barFigure = b.Add(Figure, nick: "Bar figure"); b.W(bars, barFigure, "T");
        var noise = b.Add("Random", nick: "Samples"); b.Set(noise, "N", 400); b.W(integer, noise, "S");
        var histogram = b.Add(QuickChart, nick: "Histogram"); b.W(noise, histogram, "D"); b.Set(histogram, "T", "400 random samples");
        var oWave = b.Output("Wave", waveChart);
        var oBars = b.Output("Bars", barFigure);
        var oHist = b.Output("Histogram", histogram);
        b.Section("Charts", nCharts, series, wave, waveChart, bars, barFigure, noise, histogram, oWave, oBars, oHist);

        // ---- Files
        var nFiles = b.Note("FILES\nCSV, JSON, a PDF, a 3DM, and three files in nested folders: each output kind the download path handles.");
        var csvRows = b.Add("Format", nick: "CSV rows"); b.Set(csvRows, "F", "{0},{1:0.0000}"); b.W(series, csvRows, 2); b.W(wave, csvRows, 3);
        var csvLines = b.Add("Merge", nick: "CSV lines"); b.W(b.Panel("t,value", name: "CSV header"), csvLines, 0); b.W(csvRows, csvLines, 1);
        var csv = b.Add(CreateFile, nick: "CSV"); b.W(csvLines, csv, "D"); b.Map(csv, "D", GH_DataMapping.Flatten); b.Set(csv, "N", "wave"); b.Set(csv, "Ext", ".csv"); b.Set(csv, "B64", false);
        var json = b.Add("Format", nick: "JSON"); b.Set(json, "F", "{{\"number\": {0}, \"integer\": {1}, \"text\": \"{2}\"}}");
        b.Inputs(json, 5); b.W(number, json, 2); b.W(integer, json, 3); b.W(text, json, 4);
        var jsonFile = b.Add(CreateFile, nick: "JSON file"); b.W(json, jsonFile, "D"); b.Set(jsonFile, "N", "values"); b.Set(jsonFile, "Ext", ".json"); b.Set(jsonFile, "B64", false);
        var heading = b.Add(DrawText, nick: "Heading"); b.W(text, heading, "T"); b.W(b.Pt("Text spot", 0.0, 0.0, 0.0), heading, "P");
        var body = b.Add(DrawText, nick: "Body"); b.W(echo, body, "T"); b.W(b.Pt("Body spot", 0.0, -20.0, 0.0), body, "P");
        var page = b.Add(Page, nick: "Report page"); b.W(heading, page, "Dwg"); b.W(body, page, "Dwg"); b.Set(page, "T", "Kitchen sink report");
        var doc = b.Add(Document, nick: "Report"); b.W(page, doc, "P"); b.Set(doc, "T", "Kitchen sink");
        var pdf = b.Add(RenderPdf, nick: "PDF"); b.W(doc, pdf, "Doc"); b.Set(pdf, "N", "report");
        var model = b.Add(GeometryToFile, nick: "3DM"); b.W(mesh, model, "G"); b.Set(model, "L", "Boxes"); b.Set(model, "F", "boxes"); b.Set(model, "E", ".3dm");
        var bundleNames = b.Add("Format", nick: "Bundle names"); b.Set(bundleNames, "F", "part-{0}"); b.W(b.Panel("a\nb\nc", name: "Parts", h: 60), bundleNames, 2);
        var bundle = b.Add(CreateFile, nick: "Bundle"); b.W(bundleNames, bundle, "D"); b.W(bundleNames, bundle, "N"); b.Set(bundle, "Ext", ".txt"); b.Set(bundle, "B64", false); b.Set(bundle, "Folder", "Bundle::Parts");
        var oCsv = b.Output("CSV", csv);
        var oJson = b.Output("JSON", jsonFile);
        var oPdf = b.Output("PDF", pdf);
        var o3dm = b.Output("3DM", model);
        var oBundle = b.Output("Folder of files", bundle);
        b.Section("Files", nFiles, csvRows, csvLines, csv, json, jsonFile, heading, body, page, doc, pdf, model, bundleNames, bundle, oCsv, oJson, oPdf, o3dm, oBundle);

        // ---- Messages and progress
        var nMsg = b.Note("MESSAGES\nRaise picks a level. An error blocks every output from reaching the page.");
        var raiseIdx = b.IndexOf(raise, "Raise index", "Nothing", "Remark", "Warning", "Error");
        IGH_DocumentObject Level(int level, string label)
        {
            var off = b.Add("Equality", nick: label + "?"); b.W(raiseIdx, "I", off, "A"); b.Set(off, "B", (double)(level + 1));
            var m = b.Add(Message, nick: label);
            b.W(off, "≠", m, "C"); b.Set(m, "M", $"A test {label.ToLowerInvariant()} raised from the Raise input."); b.Set(m, "L", level); b.Set(m, "N", 1);
            return m;
        }
        var remark = Level(0, "Remark");
        var warning = Level(1, "Warning");
        var error = Level(2, "Error");
        b.Section("Messages", nMsg, raiseIdx, remark, warning, error);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(KitchenSinkForm());
        return new() { (echo, null), (setDvl, null), (show, null), (waveChart, null), (barFigure, null), (histogram, null), (csv, null), (jsonFile, null), (pdf, null), (model, null), (bundle, null) };
    }

    static string KitchenSinkForm() => Json(@"{
  'name': 'Stress: Every Input and Output',
  'description': 'For developers: one of each input widget and output kind, visibility rules, a dynamic list, and messages on demand.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'look': 'studio' },
  'assets': { 'th-red': { 'img': 'RED' }, 'th-green': { 'img': 'GREEN' }, 'th-blue': { 'img': 'BLUE' } },
  'tabs': [
    { 'label': 'Basics', 'groups': [
      { 'label': 'Values', 'items': [
        { 'param': 'Number', " + SliderConfig + @" },
        { 'param': 'Integer', 'description': 'Also sets the Dynamic options and the box count.', " + SliderConfig + @" },
        { 'param': 'Boolean', 'description': 'Shows the Advanced group.' },
        'Text'
      ] },
      { 'label': 'Advanced', 'visibilityCondition': { 'mode': 'all', 'action': 'show',
          'rules': [ { 'param': 'Boolean', 'operator': 'equals', 'value': true } ] },
        'items': [ { 'param': 'Advanced', " + SliderConfig + @" } ] }
    ] },
    { 'label': 'Choices', 'groups': [
      { 'label': 'Value lists', 'items': [
        { 'param': 'Dropdown', 'widget': 'dropdown', 'config': { 'displayAs': 'dropdown' } },
        { 'param': 'Gamma note', 'visibilityCondition': { 'mode': 'all', 'action': 'show',
            'rules': [ { 'param': 'Dropdown', 'operator': 'equals', 'value': 'Gamma' } ] } },
        { 'param': 'Segmented', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } },
        { 'param': 'Tiles', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Red': { 'image': 'th-red' }, 'Green': { 'image': 'th-green' }, 'Blue': { 'image': 'th-blue' } } } }
      ] },
      { 'label': 'Dynamic', 'items': [ { 'param': 'Dynamic options', 'widget': 'dynamicValueList' }, 'Dynamic' ] }
    ] },
    { 'label': 'Media', 'groups': [
      { 'label': 'Media', 'items': [ 'Colour', 'File', 'Image' ] },
      { 'label': 'Messages', 'items': [ { 'param': 'Raise', 'widget': 'dropdown', 'config': { 'displayAs': 'segmented' } } ] }
    ] },
    { 'label': 'Outputs', 'groups': [
      { 'label': 'Text', 'items': [ 'Echo', 'Number × 2', 'Long text' ] },
      { 'label': 'Charts', 'items': [ 'Wave', 'Bars', 'Histogram' ] },
      { 'label': 'Files', 'items': [ 'CSV', 'JSON', 'PDF', '3DM', 'Folder of files' ] }
    ] }
  ]
}").Replace("RED", H.Thumb(Color.FromArgb(214, 64, 52))).Replace("GREEN", H.Thumb(Color.FromArgb(64, 160, 90))).Replace("BLUE", H.Thumb(Color.FromArgb(60, 110, 200)));
}
