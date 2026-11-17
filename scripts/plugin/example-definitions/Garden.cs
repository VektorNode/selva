using Grasshopper.Kernel;
using Rhino.Geometry;
using System.Collections.Generic;
using static SelvaBuilder;

public static partial class Definitions
{
    // ============================================================================
    // Garden sketch: walls from drawn lines, a path from a drawn curve, shrubs from placed points
    // ============================================================================

    static List<(IGH_DocumentObject, object)> Garden(B b)
    {
        b.Note("GARDEN SKETCH\n" +
               "Three inputs a person draws instead of types: walls as lines, a path as a curve, shrubs as points.\n" +
               "In Rhino the form picks them in the viewport. In Selva it draws them in the 3D view,\n" +
               "or imports them from a DXF or 3DM file. Model units are millimetres.", w: 640, h: 76);

        var (walls, wallSolids) = WallSection(b);
        var (path, paving) = PathSection(b);
        var (shrubs, bushes) = ShrubSection(b);

        // ---- 3D view
        var nView = b.Note("3D VIEW\nBrick walls, a gravel path and green shrubs.");
        var dWalls = b.Show("Walls", "Garden/Walls", wallSolids, b.Preset("Brick"));
        var dPath = b.Show("Path", "Garden/Path", paving, b.Preset("Gravel"));
        var leaf = b.Add(ThreeMaterial, nick: "Leaf");
        b.W(b.Swatch(System.Drawing.Color.FromArgb(74, 124, 63)), leaf, "C");
        b.Set(leaf, "R", 0.9);
        var dShrubs = b.Show("Shrubs", "Garden/Shrubs", bushes, leaf);
        b.Map(dShrubs, "G", GH_DataMapping.Flatten);
        // One wall per branch would give one display, and one mesh batch on the wire, per wall.
        b.Map(dWalls, "G", GH_DataMapping.Flatten);
        b.Map(dPath, "G", GH_DataMapping.Flatten);
        var combine = b.Add(GardenDisplay, nick: "Garden");
        b.W(dWalls, combine, 0);
        b.W(dPath, combine, 0);
        b.W(dShrubs, combine, 0);
        var oGarden = b.Output("Garden", combine);
        b.Section("3D view", nView);

        // ---- Quantities
        var nQty = b.Note("QUANTITIES\nLengths of what was drawn, in metres: a quick check that the sketch arrived as drawn.");
        var wallLengths = b.Add("Length", nick: "Wall lengths"); b.W(walls, wallLengths, 0);
        var wallTotal = b.Add(MassAddition, nick: "Wall total"); b.W(wallLengths, wallTotal, 0);
        var wallCount = b.Add("List Length", nick: "Wall count"); b.W(walls, wallCount, 0);
        var pathLength = b.Add("Length", nick: "Path length"); b.W(path, pathLength, 0);
        var shrubCount = b.Add("List Length", nick: "Shrub count"); b.W(shrubs, shrubCount, 0);
        var pShrubs = b.Print("Shrub count", shrubCount);
        var pWalls = b.Print("Wall count", wallCount);
        var pWallLength = b.Print("Wall length (m)", b.Fmt("{0:0.000}", b.Expr("x/1000", "Wall metres", wallTotal, xKey: "R")));
        var pPathLength = b.Print("Path length (m)", b.Fmt("{0:0.000}", b.Expr("x/1000", "Path metres", pathLength)));
        b.Section("Quantities", nQty);

        b.Bridge();
        b.AfterSolve = () => b.FormLayout(Json(@"{
  'name': 'Garden Sketch',
  'description': 'Draw walls as lines, a path as a curve and shrubs as points in the 3D view, or import them from DXF or 3DM.',
  'viewerOptions': { 'enableLocal': true, 'enableRemote': true, 'backgroundColor': '#e3e6df', 'look': 'studio' },
  'tabs': [ { 'label': 'Garden', 'groups': [
    { 'label': 'Walls', 'items': [
      'Walls',
      { 'param': 'Wall height', 'label': 'Wall height (mm)', " + SliderConfig + @" },
      { 'param': 'Wall thickness', 'label': 'Wall thickness (mm)', " + SliderConfig + @" } ] },
    { 'label': 'Path', 'items': [
      'Path',
      { 'param': 'Path width', 'label': 'Path width (mm)', " + SliderConfig + @" } ] },
    { 'label': 'Shrubs', 'items': [
      'Shrubs',
      { 'param': 'Shrub size', 'label': 'Shrub size (mm)', " + SliderConfig + @" } ] },
    { 'label': 'Quantities', 'items': [ 'Wall count', 'Wall length (m)', 'Path length (m)', 'Shrub count' ] } ] } ] }"));

        return new() { (walls, null), (wallSolids, null), (path, null), (paving, null), (shrubs, null), (bushes, null), (combine, null), (wallTotal, "R"), (pathLength, null), (shrubCount, null) };
    }

    const string GardenDisplay = "e2ba3fc1-3930-4e34-8034-7e096f419fd3";
    const string MassAddition = "5b850221-b527-4bd6-8c62-e94168cd6efa";
    const string OffsetCurve = "1a38d325-98de-455c-93f1-bca431bc1243";
    const string Sphere = "dabc854d-f50e-408a-b001-d043c7de151d";

    // ============================================================================
    // Sections
    // ============================================================================

    /// <summary>A strip <paramref name="width" /> wide centred on each curve, raised by <paramref name="height" />.</summary>
    static IGH_DocumentObject Strip(B b, string nick, IGH_DocumentObject centre, IGH_DocumentObject width, IGH_DocumentObject height)
    {
        var half = b.Expr("x/2", nick + " half width", width);
        var left = b.Add(OffsetCurve, nick: nick + " left"); b.W(centre, left, "C"); b.W(half, left, "D");
        var right = b.Add(OffsetCurve, nick: nick + " right"); b.W(centre, right, "C"); b.W(b.Expr("-x/2", nick + " other side", width), right, "D");
        var plan = b.Add("Ruled Surface", nick: nick + " plan"); b.W(left, plan, "A"); b.W(right, plan, "B");
        var up = b.Add("Unit Z", nick: nick + " up"); b.W(height, up, 0);
        var solid = b.Add("Extrude", nick: nick); b.W(plan, solid, "B"); b.W(up, solid, "D");
        return solid;
    }

    static (IGH_DocumentObject Walls, IGH_DocumentObject Solids) WallSection(B b)
    {
        var note = b.Note("WALLS\n" +
                          "A Get Line that takes any number of lines: each one is the centre line of a wall.\n" +
                          "Its Line param holds the walls the file opens with.\n" +
                          "Try: in the form, draw a line, or type a length such as 2500 and press Enter.", w: 640, h: 76);
        var walls = b.Lines("Walls", int.MaxValue,
            new Line(new Point3d(0, 0, 0), new Point3d(6000, 0, 0)),
            new Line(new Point3d(6000, 0, 0), new Point3d(6000, 4000, 0)),
            new Line(new Point3d(0, 0, 0), new Point3d(0, 2500, 0)));
        var height = b.Number("Wall height", 400, 1800, 3000, 0);
        var thickness = b.Number("Wall thickness", 100, 240, 500, 0);
        var solids = Strip(b, "Wall", walls, thickness, height);
        b.Section("Walls", note);
        return (walls, solids);
    }

    static (IGH_DocumentObject Shrubs, IGH_DocumentObject Bushes) ShrubSection(B b)
    {
        var note = b.Note("SHRUBS\n" +
                          "A Get Point that takes any number of points: each one is the centre of a shrub.\n" +
                          "Try: click a few points in the form's 3D view, then Edit points to move one.", w: 640, h: 62);
        var shrubs = b.Points("Shrubs", int.MaxValue, new Point3d(1500, 3200, 0), new Point3d(4600, 1200, 0));
        var size = b.Number("Shrub size", 200, 450, 900, 0);
        var bushes = b.Add(Sphere, nick: "Shrub"); b.W(shrubs, bushes, "B"); b.W(size, bushes, "R");
        b.Section("Shrubs", note);
        return (shrubs, bushes);
    }

    static (IGH_DocumentObject Path, IGH_DocumentObject Paving) PathSection(B b)
    {
        var note = b.Note("PATH\n" +
                          "A Get Geometry whose type filter allows curves only, and takes one: Selva offers its\n" +
                          "drawing tools because of that filter, and replaces the curve when a new one is drawn.\n" +
                          "Try: draw a Curve through a few points, or import a DXF.", w: 640, h: 76);
        var path = b.Curves("Path", 1, NurbsCurve.Create(false, 3, new[]
        {
            new Point3d(800, 600, 0), new Point3d(2200, 2600, 0), new Point3d(3800, 600, 0), new Point3d(5200, 3200, 0)
        }));
        var width = b.Number("Path width", 300, 900, 1500, 0);
        var thick = b.Panel("40", name: "Paving thickness", w: 60);
        var paving = Strip(b, "Paving", path, width, b.Add("Number", nick: "Paving depth").Also(n => b.W(thick, n, null)));
        b.Section("Path", note);
        return (path, paving);
    }
}
