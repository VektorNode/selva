using Grasshopper.Kernel;
using System;
using System.Collections.Generic;
using System.Drawing;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Perforated facade (millimetres)
    // ============================================================================

    const string Rectangle = "d93100b6-d50b-40b2-831a-814659dc38e3";
    const string RotateGeo = "b7798b74-037e-4f0c-8ac7-dc1043d093e0";
    const string Progress = "c8b23e4e-8093-406c-b859-3eba38a2bcd6";
    const string ThreeMaterial = "938b5c95-9c45-4541-966f-848910e4c154";
    const string Emissive = "7d3c1f52-9a64-4e0b-8c27-5b1e6a0f42d9";
    const string CombineDisplay = "e2ba3fc1-3930-4e34-8034-7e096f419fd3";
    const string GeometryToFile = "4b2646e6-a8b0-48b6-a566-fe5ec2376c82";
    const string CreateFile = "4a845b41-30e7-4dc7-bd47-0ac4c44e4f46";
    const string QuickChart = "1a270020-96d3-41b7-9d38-14b0164e4730";
    const string DrawCurve = "33d854ca-a7e6-48c7-819c-0fa9e63b6b4f";
    const string DrawingView = "3336b561-6152-4ca0-83d6-c0f5eed76540";
    const string RenderSvg = "69a739f3-44cb-42d7-bbf4-8a10b109aeb8";
    const string Message = "b7e4c2a1-3d9f-4e58-a6c0-8f1d5b2e7a93";

    static List<(IGH_DocumentObject, object)> Facade(B b)
    {
        b.Note("PERFORATED FACADE\nMetal panels whose holes grow toward an attractor. Change the pattern, the metal and the " +
               "attractor, then download one DXF cut file per panel and an SVG elevation. Units: millimetres.", w: 520);

        // ---- Inputs
        var nPan = b.Note("PANELS\nA grid of panels; holes sit on a square pitch inside each one.");
        var pattern = b.Choice("Pattern", 0, "Circles", "Hexagons", "Squares");
        var cols = b.Number("Columns", 2, 4, 8, 0);
        var rows = b.Number("Rows", 1, 2, 4, 0);
        var pw = b.Number("Panel width", 600, 1000, 1500, 0);
        var ph = b.Number("Panel height", 1500, 2400, 3500, 0);
        var pitch = b.Number("Hole pitch", 60, 120, 160, 0);
        b.Section("Panels", nPan, pattern, cols, rows, pw, ph, pitch);

        var nAtt = b.Note("ATTRACTOR\nHoles are largest at the attractor and shrink with distance. Invert swaps that.");
        var ax = b.Number("Attractor X", 0, 30, 100, 0);
        var ay = b.Number("Attractor Y", 0, 65, 100, 0);
        var minHole = b.Number("Smallest hole", 0, 12, 60, 0);
        var maxHole = b.Number("Largest hole", 40, 88, 95, 0);
        var invert = b.Switch("Invert", false);
        b.Section("Attractor", nAtt, ax, ay, minHole, maxHole, invert);

        var nFin = b.Note("FINISH\nCoated uses the colour; the others are measured metals. Backlit glows in the Night look.");
        var metal = b.Choice("Metal", 0, "Corten", "Copper", "Zinc", "Coated");
        var coat = b.Colour("Coating colour", Color.FromArgb(40, 70, 64));
        var backlit = b.Switch("Backlit", false);
        b.Section("Finish", nFin, metal, coat, backlit);

        // ---- Panel grid, flat in XY
        var nGrid = b.Note("PANEL GRID\nPanel corners on a 20 mm joint, laid out flat; the facade stands up at the end.");
        var stepX = b.Expr("x+20", "Column step", pw);
        var stepY = b.Expr("x+20", "Row step", ph);
        var xs = b.Add("Series", nick: "Column x"); b.Set(xs, "S", 0.0); b.W(stepX, xs, "N"); b.W(cols, xs, "C");
        var ys = b.Add("Series", nick: "Row y"); b.Set(ys, "S", 0.0); b.W(stepY, ys, "N"); b.W(rows, ys, "C");
        var corners = b.Pt("Panel corners", xs, ys, 0.0); b.Map(corners, "X", GH_DataMapping.Graft);
        var cornerList = b.Add("Flatten Tree", nick: "Corner list"); b.W(corners, cornerList, 0);
        var outline = b.Add(Rectangle, nick: "Panel outlines"); b.W(cornerList, outline, "P"); b.W(pw, outline, "X"); b.W(ph, outline, "Y");
        var outlines = b.Add("Graft Tree", nick: "One branch per panel"); b.W(outline, "R", outlines, 0);
        var width = b.Expr("x*(y+20)-20", "Facade width", cols, pw);
        var height = b.Expr("x*(y+20)-20", "Facade height", rows, ph);
        b.Section("Panel grid", nGrid, stepX, stepY, xs, ys, corners, cornerList, outline, outlines, width, height);

        // ---- Holes
        var nHoles = b.Note("HOLES\nA hole grid per panel, sized by distance to the attractor and drawn in the chosen pattern.");
        var margin = b.Add("Unit X", nick: "Margin x"); b.W(pitch, margin, 0);
        var marginY = b.Add("Unit Y", nick: "Margin y"); b.W(pitch, marginY, 0);
        var inset = b.Add("Addition", nick: "Margin"); b.W(margin, inset, "A"); b.W(marginY, inset, "B");
        var gridOrigin = b.Add("Move", nick: "Grid origins"); b.W(cornerList, gridOrigin, "G"); b.W(inset, gridOrigin, "T");
        var countX = b.Expr("floor((x-2*y)/y)", "Holes across", pw, pitch);
        var countY = b.Expr("floor((x-2*y)/y)", "Holes up", ph, pitch);
        var grid = b.Add("Grid Square", nick: "Hole grid"); b.W(gridOrigin, "G", grid, "P"); b.Map(grid, "P", GH_DataMapping.Graft); b.W(pitch, grid, "S"); b.W(countX, grid, "Ex"); b.W(countY, grid, "Ey");
        var perPanel = b.Add("Trim Tree", nick: "Holes per panel"); b.W(grid, "P", perPanel, "T"); b.Set(perPanel, "D", 2);
        var attX = b.Expr("x*y/100", "Attractor x", ax, width);
        var attY = b.Expr("x*y/100", "Attractor y", ay, height);
        var attractor = b.Pt("Attractor", attX, attY, 0.0);
        var dist = b.Add("Distance", nick: "Distance"); b.W(perPanel, dist, "A"); b.W(attractor, dist, "B");
        var spanOfDist = b.Add("Bounds", nick: "Distance range"); b.W(dist, spanOfDist, 0); b.Map(spanOfDist, 0, GH_DataMapping.Flatten);
        var rel = b.Add("Remap Numbers", nick: "Relative distance"); b.W(dist, rel, "V"); b.W(spanOfDist, rel, "S"); b.Set(rel, "T", new Rhino.Geometry.Interval(0, 1));
        var t = b.Expr("if(y, 1-x, x)", "Falloff", rel, invert);
        var target = b.Add("Construct Domain", nick: "Hole range"); b.W(maxHole, target, "A"); b.W(minHole, target, "B");
        var share = b.Add("Remap Numbers", nick: "Hole share"); b.W(t, share, "V"); b.W(target, share, "T");
        b.Set(share, "S", new Rhino.Geometry.Interval(0, 1));
        var radius = b.Expr("x*y/200", "Hole radius", share, pitch);
        var patternIdx = b.IndexOf(pattern, "Pattern index", "Circles", "Hexagons", "Squares");
        var sides = b.Lookup(patternIdx, "I", "Sides", "24", "6", "4");
        var holes = b.Add("Polygon", nick: "Holes"); b.W(perPanel, holes, "P"); b.W(radius, holes, "R"); b.W(sides, holes, "S");
        b.Section("Holes", nHoles, margin, marginY, inset, gridOrigin, countX, countY, grid, perPanel, attX, attY, attractor, dist, spanOfDist, rel, t, target, share, radius, patternIdx, sides, holes);

        // ---- Panels: trimmed, extruded, stood up
        var nPanel = b.Note("PANELS\nEach outline with its holes becomes one punched sheet; everything rotates upright.");
        var cutLines = b.Add("Merge", nick: "Cut lines"); b.W(outlines, cutLines, 0); b.W(holes, "P", cutLines, 1);
        var trimming = b.Add(Progress, nick: "Trimming"); b.W(cutLines, trimming, "D"); b.Set(trimming, "M", "Punching the panels…");
        var sheets = b.Add("Boundary Surfaces", nick: "Sheets"); b.W(trimming, sheets, 0);
        // Sheets stay single surfaces: extruding 3 mm made every hole a cylinder face and the solve 30 s slower.
        var solid = sheets;
        var upright = b.Add("YZ Plane", nick: "Hinge");
        var quarter = b.Add("Pi", nick: "90°"); b.Set(quarter, 0, 0.5);
        var standPanels = b.Add(RotateGeo, nick: "Stand panels"); b.W(solid, standPanels, "G"); b.W(quarter, standPanels, "A"); b.W(upright, standPanels, "P");
        var wallRect = b.Add(Rectangle, nick: "Wall outline"); b.W(width, wallRect, "X"); b.W(height, wallRect, "Y");
        var wallSrf = b.Add("Boundary Surfaces", nick: "Wall face"); b.W(wallRect, "R", wallSrf, 0);
        var lightBack = b.Add("Unit Z", nick: "Light offset"); b.Set(lightBack, 0, -120.0);
        var lightSrf = b.Add("Move", nick: "Light panel"); b.W(wallSrf, lightSrf, "G"); b.W(lightBack, lightSrf, "T");
        var wallDepth = b.Add("Unit Z", nick: "Wall depth"); b.Set(wallDepth, 0, -300.0);
        var wallBack = b.Add("Move", nick: "Wall back"); b.W(wallSrf, wallBack, "G"); b.W(b.Add("Unit Z").Also(u => b.Set(u, 0, -140.0)), wallBack, "T");
        var wall = b.Add("Extrude", nick: "Wall"); b.W(wallBack, wall, "B"); b.W(wallDepth, wall, "D");
        var standWall = b.Add(RotateGeo, nick: "Stand wall"); b.W(wall, standWall, "G"); b.W(quarter, standWall, "A"); b.W(upright, standWall, "P");
        var standLight = b.Add(RotateGeo, nick: "Stand light"); b.W(lightSrf, standLight, "G"); b.W(quarter, standLight, "A"); b.W(upright, standLight, "P");
        b.Section("Panels", nPanel, cutLines, trimming, sheets, upright, quarter, standPanels, wallRect, wallSrf, lightBack, lightSrf, wallDepth, wallBack, wall, standWall, standLight);

        // ---- 3D view
        var nView = b.Note("3D VIEW\nPanels in the chosen metal, a plaster wall behind, and a light box when backlit.");
        var metalIdx = b.IndexOf(metal, "Metal index", "Corten", "Copper", "Zinc", "Coated");
        var presetNo = b.Lookup(metalIdx, "I", "Metal preset", PresetText("Corten steel"), PresetText("Copper"), PresetText("Titanium zinc, weathered"), PresetText("Coil-coated (RAL)"));
        var metalMat = b.Add(MaterialPreset, nick: "Metal"); b.W(presetNo, metalMat, 0);
        var coated = b.Add(ThreeMaterial, nick: "Coated"); b.W(metalMat, coated, "B"); b.W(coat, coated, "C");
        var isCoated = b.Add("Equality", nick: "Coated?"); b.W(metalIdx, "I", isCoated, "A"); b.Set(isCoated, "B", 3.0);
        var finish = b.Add("Stream Filter", nick: "Finish"); b.W(isCoated, "=", finish, 0); b.W(metalMat, finish, 1); b.W(coated, finish, 2);
        var plaster = b.Preset("Plaster", "Plaster");
        var glow = b.Add(Emissive, nick: "Light box"); b.W(b.Swatch(Color.FromArgb(255, 210, 150)), glow, "C"); b.W(b.Expr("if(x, 2.5, 0)", "Light strength", backlit), glow, "S");
        var dPanels = b.Show("Panels", "Facade/Panels", standPanels, finish);
        var dWall = b.Show("Wall", "Facade/Wall", standWall, plaster);
        var dLight = b.Show("Light box", "Facade/Lighting", standLight, glow);
        var combine = b.Add(CombineDisplay, nick: "Facade");
        foreach (var d in new[] { dPanels, dWall, dLight }) b.W(d, combine, 0);
        var oFacade = b.Output("Facade", combine);
        b.Section("3D view", nView, metalIdx, presetNo, metalMat, coated, isCoated, finish, plaster, glow, dPanels, dWall, dLight, combine, oFacade);

        // ---- Quantities
        var nQ = b.Note("QUANTITIES\nHole count, open area and sheet weight, and a chart of hole sizes.");
        var holeList = b.Add("Flatten Tree", nick: "All holes"); b.W(holes, "P", holeList, 0);
        var holeCount = b.Add("List Length", nick: "Hole count"); b.W(holeList, holeCount, 0);
        var holeArea = b.Add("Area", nick: "Hole areas"); b.W(holeList, holeArea, 0);
        var openArea = b.Add("Mass Addition", nick: "Open area"); b.W(holeArea, "A", openArea, 0);
        var panelCount = b.Add("List Length", nick: "Panel count"); b.W(cornerList, panelCount, 0);
        var sheetArea = b.Expr("x*y", "Panel area", pw, ph);
        var grossArea = b.Mul(sheetArea, panelCount, "Sheet area");
        var openPct = b.Expr("100*x/y", "Open area %", openArea, grossArea, "R");
        var weight = b.Expr("(x-y)*3*7.85e-6", "Weight", grossArea, openArea, null, "R");
        var diameters = b.Expr("2*x", "Diameters", radius);
        var flatDia = b.Add("Flatten Tree", nick: "Diameter list"); b.W(diameters, flatDia, 0);
        var chart = b.Add(QuickChart, nick: "Hole chart"); b.W(flatDia, chart, "D"); b.Set(chart, "T", "Hole sizes (mm)");
        var tooOpen = b.Add("Smaller Than", nick: "Stiff enough?"); b.W(openPct, tooOpen, "A"); b.Set(tooOpen, "B", 55.0);
        var warn = b.Add(Message, nick: "Too open");
        b.W(tooOpen, "<", warn, "C"); b.Set(warn, "M", "Over 55 % open: the sheet needs stiffeners. Shrink the largest hole or widen the pitch."); b.Set(warn, "L", 1); b.Set(warn, "N", 1);
        var pPanels = b.Print("Panels", panelCount);
        var pHoles = b.Print("Holes", holeCount);
        var pOpen = b.Print("Open area (%)", b.Fmt("{0:0.0}", openPct));
        var pWeight = b.Print("Sheet weight (kg)", b.Fmt("{0:0}", weight));
        var oChart = b.Output("Hole sizes", chart);
        b.Section("Quantities", nQ, holeList, holeCount, holeArea, openArea, panelCount, sheetArea, grossArea, openPct, weight, diameters, flatDia, chart, tooOpen, warn, pPanels, pHoles, pOpen, pWeight, oChart);

        // ---- Downloads
        var nFiles = b.Note("DOWNLOADS\nOne DXF per panel in a Cut files folder, and the whole elevation as SVG.");
        var panelNo = b.Add("Series", nick: "Panel numbers"); b.Set(panelNo, "S", 1.0); b.Set(panelNo, "N", 1.0); b.W(panelCount, panelNo, "C");
        var names = b.Add("Format", nick: "File names"); b.Set(names, "F", "panel-{0:00}"); b.W(panelNo, names, 2);
        var nameTree = b.Add("Graft Tree", nick: "Name per panel"); b.W(names, nameTree, 0); b.Map(nameTree, 0, GH_DataMapping.Flatten);
        var dxf = b.Add(GeometryToFile, nick: "Cut files"); b.W(cutLines, dxf, "G"); b.W(nameTree, dxf, "F"); b.Set(dxf, "E", ".dxf"); b.Set(dxf, "Folder", "Cut files"); b.Set(dxf, "L", "Cut");
        var oDxf = b.Output("Cut files (DXF)", dxf);
        var drawAll = b.Add(DrawCurve, nick: "Draw cut lines"); b.W(cutLines, drawAll, "C"); b.Map(drawAll, "C", GH_DataMapping.Flatten);
        var elevation = b.Add(DrawingView, nick: "Elevation"); b.W(drawAll, elevation, "Dwg"); b.Map(elevation, "Dwg", GH_DataMapping.Flatten);
        var svg = b.Add(RenderSvg, nick: "SVG"); b.W(elevation, "Dwg", svg, "Doc"); b.Set(svg, "N", "facade-elevation"); b.Set(svg, "AF", true);
        var oSvg = b.Output("Elevation (SVG)", svg);
        b.Section("Downloads", nFiles, panelNo, names, nameTree, dxf, oDxf, drawAll, elevation, svg, oSvg);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(FacadeForm());
        return new() { (outline, "R"), (cutLines, null), (grid, "P"), (perPanel, null), (radius, null), (holes, "P"), (sheets, null), (standPanels, null), (combine, null), (openPct, null), (weight, null), (dxf, null), (svg, null) };
    }

    static string FacadeForm() => Json(@"{
  'name': 'Perforated Facade',
  'description': 'Metal panels whose holes grow toward an attractor. Download one DXF cut file per panel and an SVG elevation.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#dfe3e4', 'look': 'studio' },
  'assets': {
    'ic-circles': { 'd': 'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0' },
    'ic-hexagons': { 'd': 'M12 3l7 4v8l-7 4-7-4V7z' },
    'ic-squares': { 'd': 'M4 4h7v7H4zM13 13h7v7h-7z' },
    'th-corten': { 'img': 'CORTEN' },
    'th-copper': { 'img': 'COPPER' },
    'th-zinc': { 'img': 'ZINC' },
    'th-coated': { 'img': 'COATED' }
  },
  'tabs': [
    { 'label': 'Panels', 'groups': [
      { 'label': 'Pattern', 'items': [
        { 'param': 'Pattern', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Circles': { 'icon': 'ic-circles' }, 'Hexagons': { 'icon': 'ic-hexagons' }, 'Squares': { 'icon': 'ic-squares' } } } },
        { 'param': 'Hole pitch', 'label': 'Hole pitch (mm)', " + SliderConfig + @" }
      ] },
      { 'label': 'Grid', 'items': [
        { 'param': 'Columns', " + SliderConfig + @" },
        { 'param': 'Rows', " + SliderConfig + @" },
        { 'param': 'Panel width', 'label': 'Panel width (mm)', " + SliderConfig + @" },
        { 'param': 'Panel height', 'label': 'Panel height (mm)', " + SliderConfig + @" }
      ] }
    ] },
    { 'label': 'Attractor', 'groups': [
      { 'label': 'Position', 'items': [
        { 'param': 'Attractor X', 'label': 'Across (%)', " + SliderConfig + @" },
        { 'param': 'Attractor Y', 'label': 'Up (%)', " + SliderConfig + @" }
      ] },
      { 'label': 'Hole size', 'items': [
        { 'param': 'Smallest hole', 'label': 'Smallest (% of pitch)', " + SliderConfig + @" },
        { 'param': 'Largest hole', 'label': 'Largest (% of pitch)', " + SliderConfig + @" },
        { 'param': 'Invert', 'description': 'Small holes at the attractor, large ones far away.' }
      ] }
    ] },
    { 'label': 'Finish', 'groups': [
      { 'label': 'Metal', 'items': [
        { 'param': 'Metal', 'widget': 'dropdown', 'config': { 'displayAs': 'tiles', 'optionMedia': {
            'Corten': { 'image': 'th-corten' }, 'Copper': { 'image': 'th-copper' }, 'Zinc': { 'image': 'th-zinc' }, 'Coated': { 'image': 'th-coated' } } } },
        { 'param': 'Coating colour', 'visibilityCondition': { 'mode': 'all', 'action': 'show',
            'rules': [ { 'param': 'Metal', 'operator': 'equals', 'value': 'Coated' } ] } },
        { 'param': 'Backlit', 'description': 'A light box behind the panels. Try the Night look.' }
      ] }
    ] },
    { 'label': 'Results', 'groups': [
      { 'label': 'Quantities', 'items': [ 'Panels', 'Holes', 'Open area (%)', 'Sheet weight (kg)' ] },
      { 'label': 'Hole sizes', 'items': [ 'Hole sizes' ] },
      { 'label': 'Downloads', 'items': [ 'Cut files (DXF)', 'Elevation (SVG)' ] }
    ] }
  ]
}").Replace("CORTEN", H.Thumb(Color.FromArgb(142, 76, 42)))
   .Replace("COPPER", H.Thumb(Color.FromArgb(196, 120, 82)))
   .Replace("ZINC", H.Thumb(Color.FromArgb(112, 117, 120)))
   .Replace("COATED", H.Stripes(Color.FromArgb(40, 70, 64), Color.FromArgb(200, 120, 60), 12));
}

static class Fluent
{
    public static T Also<T>(this T o, Action<T> f) { f(o); return o; }
}
