using Grasshopper.Kernel;
using System.Drawing;
using System.Linq;
using static GhIn;

public static partial class Definitions
{
    /// <summary>A lamella set: its centre lines, boards and cut lengths.</summary>
    public record struct LamellaSet(string Name, GhOut Curves, GhOut Boards, GhOut Lengths);

    /// <summary>What the drawing set draws, all in model metres.</summary>
    public record struct PavilionModel(
        IGH_DocumentObject Shell, LamellaSet A, LamellaSet B, GhOut Edges,
        IGH_DocumentObject Span, IGH_DocumentObject Depth, IGH_DocumentObject Height, GhNode HalfSpan, GhNode HalfDepth,
        GhNode LamellaDepth, GhOut LamellaLines, GhOut Corners, GhOut BenchOutlines, GhNode BenchHalf, GhNode BenchOffset,
        GhOut Lamps, GhOut Hangs, IGH_DocumentObject Timber, IGH_DocumentObject Spacing, IGH_DocumentObject DepthCm,
        IGH_DocumentObject WidthCm, GhOut Count, GhOut TotalLength, GhNode BeamRadius);

    // ============================================================================
    // Pavilion drawing set: two A2 sheets at one standard scale
    // ============================================================================

    /// <summary>
    ///     Geometry stays in metres and passes to the views raw. Each view's Length (paper mm, Units =
    ///     millimetres) is its longest model side in mm over the scale's denominator, so every view
    ///     prints at exactly 1:100, 1:200 or 1:500. Dimension labels are written in millimetres.
    /// </summary>
    static IGH_DocumentObject PavilionDrawings(B b, PavilionModel m)
    {
        const double Margin = 2.5;  // the square beyond the shell's footprint, in metres

        // ---- Scale and styles
        var nScale = b.Note("SHEET SCALE\nThe smallest of 1:100, 1:200 and 1:500 at which plan, section and elevation fit an A2 sheet.");
        var widthNeed = b.Ev("(x+10)*1000/520", "Width needs 1:", b.Addition(m.Span, m.Depth));
        var heightNeed = b.Ev("(x+5.2)*1000/270", "Height needs 1:", b.Addition(m.Depth, m.Height));
        var den = b.StandardScale(b.Maximum(widthNeed, heightNeed), 100, 200, 500);
        var scaleText = b.Format(Format: "1:{0}", Data0: den, nick: "Scale text");
        var longestPlan = b.Maximum(m.Span, m.Depth, nick: "Longest side");
        var lenPlan = b.ViewLength("Plan length (mm)", longestPlan, den, Margin);
        var lenSection = b.ViewLength("Section length (mm)", m.Span, den, Margin);
        var lenEnd = b.ViewLength("End length (mm)", m.Depth, den, Margin);
        var lenAxo = b.Ev($"(x+{2 * Margin})*1150/y", "Axo length (mm)", m.Depth, den);

        var hair = b.PathStyle(StrokeColor: b.Swatch(Color.FromArgb(160, 160, 160)), StrokeWidth: 0.09, nick: "Hairline");
        var thin = b.PathStyle(StrokeColor: b.Swatch(Color.FromArgb(80, 80, 80)), StrokeWidth: 0.13, nick: "Thin");
        var medium = b.PathStyle(StrokeWidth: 0.25, nick: "Medium");
        var heavy = b.PathStyle(StrokeWidth: 0.5, nick: "Heavy");
        var cut = b.PathStyle(StrokeWidth: 0.13, FillColor: b.Swatch(Color.Black), Fill: true, nick: "Cut");
        var concrete = b.PathStyle(StrokeWidth: 0.25, FillColor: b.Swatch(Color.FromArgb(205, 205, 205)), Fill: true, nick: "Concrete");
        var earth = b.PathStyle(StrokeWidth: 0.25, Fill: true, HatchPattern: 1, nick: "Ground hatch");
        var chain = b.PathStyle(StrokeWidth: 0.25, DashPattern: new object[] { 8.0, 1.5, 1.0, 1.5 }, nick: "Section line");
        var titleStyle = b.TextStyle(FontSize: 4.0, Weight: 1, nick: "View title");
        var tagStyle = b.TextStyle(FontSize: 4.0, Weight: 1, HorizontalAnchor: 1, nick: "Section tag");
        var noteStyle = b.TextStyle(FontSize: 2.5, nick: "Note text");
        var numberStyle = b.TextStyle(FontSize: 1.6, HorizontalAnchor: 1, VerticalAnchor: 1, nick: "Lamella number");
        b.Section("Sheet scale and styles", nScale);

        GhNode Plus(object x, double c, string nick) => b.Ev($"x+{c}", nick, x);
        GhNode Minus(object x, double c, string nick) => b.Ev($"-(x+{c})", nick, x);

        // ---- Plan
        var nPlan = b.Note("PLAN\nLamella centre lines, edge beams, footings, benches and lamps, the square, and the section line A–A.");
        var sqX = Plus(m.HalfSpan, Margin, "Square half length"); var sqY = Plus(m.HalfDepth, Margin, "Square half width");
        var square = b.Box("Square outline", b.Negative(sqX), sqX, b.Negative(sqY), sqY);
        var footCircles = b.Circle(Plane: Flatten(m.Corners), Radius: 0.35, nick: "Footing circles");
        var lampCircles = b.Circle(Plane: m.Lamps, Radius: 0.17, nick: "Lamp circles");
        var cutEnd = Plus(m.HalfSpan, 1.5, "Section line end");
        var cutLine = b.Line(StartPoint: b.Pt("Cut start", b.Negative(cutEnd), 0.0, 0.0), EndPoint: b.Pt("Cut end", cutEnd, 0.0, 0.0), nick: "Section line");
        var tagX = Plus(m.HalfSpan, 0.9, "Tag x");
        var tagA1 = b.DrawText(Text: "A", Position: b.Pt("Tag left", b.Negative(tagX), 0.5, 0.0), Style: tagStyle, nick: "Tag A left");
        var tagA2 = b.DrawText(Text: "A", Position: b.Pt("Tag right", tagX, 0.5, 0.0), Style: tagStyle, nick: "Tag A right");
        var dimOff = b.Ev($"-({Margin}*1000/x+8)", "Dimension offset (mm)", den);
        var spanDim = b.Dimension("Span dimension", b.Pt("SW corner", b.Negative(m.HalfSpan), b.Negative(m.HalfDepth), 0.0), b.Pt("SE corner", m.HalfSpan, b.Negative(m.HalfDepth), 0.0), dimOff, m.Span);
        var depthDim = b.Dimension("Depth dimension", b.Pt("SE corner ", m.HalfSpan, b.Negative(m.HalfDepth), 0.0), b.Pt("NE corner", m.HalfSpan, m.HalfDepth, 0.0), dimOff, m.Depth);
        var plan = b.ScaledView("Plan view", lenPlan,
            b.Draw(square, medium, "Draw square"), b.Draw(m.LamellaLines, thin, "Draw lamellas"), b.Draw(m.Edges, heavy, "Draw edge beams"),
            b.Draw(footCircles, concrete, "Draw footings"), b.Draw(m.BenchOutlines, medium, "Draw benches"), b.Draw(lampCircles, thin, "Draw lamps"),
            b.Draw(cutLine, chain, "Draw section line"), tagA1.Drawing, tagA2.Drawing, spanDim, depthDim);
        b.Section("Plan", nPlan);

        // ---- Section A–A along the span, looking north
        var nSec = b.Note("SECTION A–A\nCut through the boards on y = 0 (black), with the lamellas, beams, benches and lamps beyond it.");
        var xz = b.XZPlane(nick: "Section plane");
        var xy = b.XYPlane(nick: "Sheet plane");
        GhOut ToSection(object g, string nick) => b.Orient(Geometry: g, Source: xz, Target: xy, nick: nick).Geometry;
        var cutBoards = b.BrepPlane(Brep: Flatten(m.A.Boards), Plane: xz, nick: "Cut set A");
        var cutBoardsB = b.BrepPlane(Brep: Flatten(m.B.Boards), Plane: xz, nick: "Cut set B");
        GhOut Beyond(GhOut curves, string nick)
        {
            var mid = b.Deconstruct(Point: b.CurveMiddle(Curve: curves), nick: nick + " midpoints");
            return b.Dispatch(List: curves, DispatchPattern: b.LargerThan(FirstNumber: mid.YComponent, SecondNumber: -0.05), nick: nick).ListA;
        }
        var lamBeyond = Beyond(m.LamellaLines, "Lamellas beyond");
        var edgesBeyond = Beyond(m.Edges, "Edges beyond");
        var lampMid = b.Deconstruct(Point: m.Lamps, nick: "Lamp coordinates");
        var lampsB = b.Dispatch(List: m.Lamps, DispatchPattern: b.LargerThan(FirstNumber: lampMid.YComponent, SecondNumber: 0.0), nick: "Lamps beyond");
        var hangsB = b.Dispatch(List: m.Hangs, DispatchPattern: b.LargerThan(FirstNumber: lampMid.YComponent, SecondNumber: 0.0), nick: "Hangs beyond");
        var secLamps = b.Circle(Plane: ToSection(lampsB.ListA, "Lamps in section"), Radius: 0.17, nick: "Section lamp circles");
        var secCords = b.Line(StartPoint: ToSection(hangsB.ListA, "Hangs in section"), EndPoint: ToSection(lampsB.ListA, "Lamps in section "), nick: "Section cords");
        var secSlab = b.Box("Section slab", b.Negative(sqX), sqX, -0.2, 0.0);
        var secGround = b.Line(StartPoint: b.Pt("Ground west", b.Negative(sqX), 0.0, 0.0), EndPoint: b.Pt("Ground east", sqX, 0.0, 0.0), nick: "Section ground");
        var footX = b.Merge(Data1: b.Negative(m.HalfSpan), Data2: m.HalfSpan, nick: "Footing x");
        var secFootings = b.Rectangle(Plane: b.Pt("Footing feet", footX, 0.0, 0.0), XSize: b.ConstructDomain(DomainStart: -0.35, DomainEnd: 0.35),
            YSize: b.ConstructDomain(DomainStart: 0.0, DomainEnd: 0.45), nick: "Section footings").Rectangle;
        var secBench = b.Box("Section bench", b.Negative(m.BenchHalf), m.BenchHalf, 0.0, 0.45);
        var levelX = Plus(m.HalfSpan, 1.0, "Level x");
        var secHeight = b.Dimension("Height dimension", b.Pt("Level 0", levelX, 0.0, 0.0), b.Pt("Level crown", levelX, m.Height, 0.0), -4.0, m.Height);
        var section = b.ScaledView("Section view", lenSection,
            b.Draw(secSlab, earth, "Draw slab"), b.Draw(secGround, heavy, "Draw ground"), b.Draw(ToSection(lamBeyond, "Lamellas in section"), hair, "Draw lamellas beyond"),
            b.Draw(ToSection(edgesBeyond, "Edges in section"), medium, "Draw beams beyond"), b.Draw(secFootings, concrete, "Draw section footings"),
            b.Draw(secBench, medium, "Draw section bench"), b.Draw(secCords, thin, "Draw cords"), b.Draw(secLamps, thin, "Draw section lamps"),
            b.Draw(ToSection(cutBoards.Curves, "Set A cut"), cut, "Draw cut A"), b.Draw(ToSection(cutBoardsB.Curves, "Set B cut"), cut, "Draw cut B"), secHeight);
        b.Section("Section A–A", nSec);

        // ---- East elevation, looking west
        var nEnd = b.Note("EAST ELEVATION\nThe whole shell seen from the east: its end arch, every lamella behind it, footings, benches and lamps.");
        var yz = b.YZPlane(nick: "Elevation plane");
        GhOut ToEnd(object g, string nick) => b.Orient(Geometry: g, Source: yz, Target: xy, nick: nick).Geometry;
        var endSlab = b.Box("Elevation slab", b.Negative(sqY), sqY, -0.2, 0.0);
        var endGround = b.Line(StartPoint: b.Pt("Ground south", b.Negative(sqY), 0.0, 0.0), EndPoint: b.Pt("Ground north", sqY, 0.0, 0.0), nick: "Elevation ground");
        var footY = b.Merge(Data1: b.Negative(m.HalfDepth), Data2: m.HalfDepth, nick: "Footing y");
        var endFootings = b.Rectangle(Plane: b.Pt("Footing feet y", footY, 0.0, 0.0), XSize: b.ConstructDomain(DomainStart: -0.35, DomainEnd: 0.35),
            YSize: b.ConstructDomain(DomainStart: 0.0, DomainEnd: 0.45), nick: "Elevation footings").Rectangle;
        var benchYs = b.Merge(Data1: b.Negative(m.BenchOffset), Data2: m.BenchOffset, nick: "Bench y");
        var endBenches = b.Rectangle(Plane: b.Pt("Bench feet", benchYs, 0.0, 0.0), XSize: b.ConstructDomain(DomainStart: -0.25, DomainEnd: 0.25),
            YSize: b.ConstructDomain(DomainStart: 0.0, DomainEnd: 0.45), nick: "Elevation benches").Rectangle;
        var endLamps = b.Circle(Plane: ToEnd(m.Lamps, "Lamps in elevation"), Radius: 0.17, nick: "Elevation lamp circles");
        var endCords = b.Line(StartPoint: ToEnd(m.Hangs, "Hangs in elevation"), EndPoint: ToEnd(m.Lamps, "Lamps in elevation "), nick: "Elevation cords");
        var levelY = Plus(m.HalfDepth, 1.0, "Level y");
        var endHeight = b.Dimension("End height dimension", b.Pt("End level 0", levelY, 0.0, 0.0), b.Pt("End level crown", levelY, m.Height, 0.0), -4.0, m.Height);
        var end = b.ScaledView("Elevation view", lenEnd,
            b.Draw(endSlab, earth, "Draw elevation slab"), b.Draw(endGround, heavy, "Draw elevation ground"), b.Draw(ToEnd(m.LamellaLines, "Lamellas in elevation"), thin, "Draw elevation lamellas"),
            b.Draw(ToEnd(m.Edges, "Edges in elevation"), heavy, "Draw elevation beams"), b.Draw(endFootings, concrete, "Draw elevation footings"),
            b.Draw(endBenches, medium, "Draw elevation benches"), b.Draw(endCords, thin, "Draw elevation cords"), b.Draw(endLamps, thin, "Draw elevation lamps"), endHeight);
        b.Section("East elevation", nEnd);

        // ---- Axonometric from the south-east
        var nAxo = b.Note("AXONOMETRIC\nThe model seen from the south-east and above: the view plane's x runs (1, 1, 0) and its y (-1, 1, 2).");
        var axoPlane = b.ConstructPlane(Origin: b.Pt("Axo origin", 0.0, 0.0, 0.0), XAxis: b.VectorXYZ(XComponent: 1.0, YComponent: 1.0, ZComponent: 0.0),
            YAxis: b.VectorXYZ(XComponent: -1.0, YComponent: 1.0, ZComponent: 2.0), nick: "Axo plane");
        GhOut ToAxo(object g, string nick) => b.Orient(Geometry: g, Source: axoPlane, Target: xy, nick: nick).Geometry;
        var undersides = b.Move(Geometry: m.LamellaLines, Motion: b.UnitZ(Factor: b.Negative(m.LamellaDepth)), nick: "Lamella undersides");
        var axo = b.ScaledView("Axo view", lenAxo,
            b.Draw(ToAxo(square, "Square in axo"), medium, "Draw axo square"), b.Draw(ToAxo(undersides.Geometry, "Undersides in axo"), hair, "Draw axo undersides"),
            b.Draw(ToAxo(m.LamellaLines, "Lamellas in axo"), thin, "Draw axo lamellas"), b.Draw(ToAxo(m.Edges, "Edges in axo"), heavy, "Draw axo beams"),
            b.Draw(ToAxo(footCircles, "Footings in axo"), medium, "Draw axo footings"), b.Draw(ToAxo(m.BenchOutlines, "Benches in axo"), thin, "Draw axo benches"));
        b.Section("Axonometric", nAxo);

        // ---- Sheet 1: general arrangement
        var nSheet = b.Note("SHEET 1: GENERAL ARRANGEMENT\nPlan and axonometric on top, section and elevation below. The notes and title block sit in the footer, bottom right.");
        var beamMm = b.Ev("x*2000", "Beam diameter (mm)", m.BeamRadius);
        var notes = b.Format(Format: "NOTES\n1. Dimensions in millimetres, heights above the finished square.\n2. Lamellas: {0} glulam, {1:0} × {2:0} mm, {3} pieces, {4:0} m in all.\n" +
                                     "3. Lamellas cut on vertical planes at 45°, {5:0.00} m apart.\n4. Edge beams: steel tube Ø {6:0} mm. Footings: concrete Ø 700 mm.\n" +
                                     "5. Drawn by Selva from the model: change an input and the sheet redraws.",
            Data0: b.ChoiceText(m.Timber), Data1: b.Multiplication(m.WidthCm, 10.0), inputs: 9, nick: "Notes text");
        b.Feed(notes.Obj, 4, b.Multiplication(m.DepthCm, 10.0)); b.Feed(notes.Obj, 5, m.Count); b.Feed(notes.Obj, 6, m.TotalLength);
        b.Feed(notes.Obj, 7, m.Spacing); b.Feed(notes.Obj, 8, beamMm);
        var notesBlock = b.TextFlow(Text: notes, Width: 190.0, Style: noteStyle, nick: "Notes");
        var title1 = b.TitleBlock(Project: "Selva showcase", Owner: "Example client", Title: "Timber lamella pavilion: general arrangement", DrawingNo: "LP-100",
            Revision: "A", Scale: scaleText, Sheet: "{page}/{pages}", Date: "{date:dd.MM.yyyy}", CreatedBy: "Selva", Width: 190.0, nick: "Title block");
        var sheet1 = b.SheetGrid("Sheet 1 layout", new object[] { 0.0, -1.0 },
            (plan, 0, 0), (axo, 0, 1), (b.Caption("PLAN", scaleText, titleStyle), 1, 0), (b.Caption("AXONOMETRIC", null, titleStyle), 1, 1),
            (section, 2, 0), (end, 2, 1), (b.Caption("SECTION A–A", scaleText, titleStyle), 3, 0), (b.Caption("EAST ELEVATION", scaleText, titleStyle), 3, 1));
        var page1 = b.Page(Drawings: sheet1, Title: "General arrangement", Override: b.Footer("Sheet 1 footer", notesBlock.Drawing, title1.Drawing), KeepTogether: true, nick: "Sheet 1");
        b.Section("Sheet 1", nSheet);

        // ---- Sheet 2: lamella key plan and schedule
        var nSchedule = b.Note("SHEET 2: LAMELLA SCHEDULE\nEvery lamella numbered on a key plan, and its length and volume in a table per set. Numbers match the cut list.");
        GhOut Numbers(LamellaSet set) =>
            b.Format(Format: set.Name + "{0:00}", Data0: b.Series(Start: 1.0, Step: 1.0, Count: b.ListLength(List: set.Lengths)), nick: "Set " + set.Name + " numbers");
        GhOut Tags(LamellaSet set, GhOut numbers, double angle) =>
            b.DrawText(Text: numbers, Position: b.CurveMiddle(Curve: set.Curves), Style: numberStyle, Rotation: angle, Background: b.Swatch(Color.White), Padding: 0.3,
                nick: "Set " + set.Name + " tags").Drawing;
        GhOut Schedule(LamellaSet set, GhOut numbers)
        {
            var lens = b.Format(Format: "{0:0.000}", Data0: set.Lengths, nick: "Set " + set.Name + " length text");
            var vols = b.Format(Format: "{0:0.000}", Data0: b.Ev("x*y", "Set " + set.Name + " volumes", set.Lengths, b.Ev("x*y/10000", "Section (m²)", m.WidthCm, m.DepthCm)), nick: "Set " + set.Name + " volume text");
            var columns = b.Entwine(Branch00: numbers, Branch01: lens, Branch02: vols, nick: "Set " + set.Name + " columns");
            var rows = b.FlipMatrix(Data: columns, nick: "Set " + set.Name + " rows");
            return b.Table(Headers: new object[] { "Lamella", "Length (m)", "Volume (m³)" }, Rows: rows, ColumnWidths: new object[] { 18.0, 24.0, 24.0 }, RowHeight: 4.2,
                DefaultStyle: noteStyle, ColumnAlign: new object[] { "l", "r", "r" }, BorderStyle: 1, nick: "Set " + set.Name + " schedule").Drawing;
        }
        var numbersA = Numbers(m.A);
        var numbersB = Numbers(m.B);
        var keyPlan = b.ScaledView("Key plan view", lenPlan, b.Draw(square, medium, "Key square"), b.Draw(m.LamellaLines, hair, "Key lamellas"), b.Draw(m.Edges, medium, "Key edges"),
            Tags(m.A, numbersA, 45.0), Tags(m.B, numbersB, -45.0));
        var title2 = b.TitleBlock(Variant: 1, Project: "Selva showcase", Title: "Timber lamella pavilion: lamella schedule", DrawingNo: "LP-101", Revision: "A",
            Scale: scaleText, Sheet: "{page}/{pages}", Date: "{date:dd.MM.yyyy}", Width: 190.0, nick: "Title strip");
        var sheet2 = b.SheetGrid("Sheet 2 layout", new object[] { 0.0, 0.0, 0.0 },
            (b.Caption("KEY PLAN", scaleText, titleStyle), 0, 0), (b.Caption("SET A", null, titleStyle), 0, 1), (b.Caption("SET B", null, titleStyle), 0, 2),
            (keyPlan, 1, 0), (Schedule(m.A, numbersA), 1, 1), (Schedule(m.B, numbersB), 1, 2));
        var page2 = b.Page(Drawings: sheet2, Title: "Lamella schedule", Override: b.Footer("Sheet 2 footer", title2.Drawing), KeepTogether: true, nick: "Sheet 2");
        b.Section("Sheet 2", nSchedule);

        // ---- Document
        var nDoc = b.Note("DRAWING SET\nBoth sheets on A2 landscape with 12 mm margins, rendered to one PDF.");
        var paper = b.LayoutOverride(PaperSize: 2, Landscape: true, Margin: 12.0, Units: 1, nick: "A2 landscape");
        var pages = b.Merge(Data1: page1, Data2: page2, nick: "Pages");
        var doc = b.Document(Pages: pages, Title: "Timber lamella pavilion", Author: "Selva", Override: paper, nick: "Drawing set");
        var drawing = b.Add("c8b23e4e-8093-406c-b859-3eba38a2bcd6", nick: "Drawing the sheets");
        b.Set(drawing, "M", "Drawing the sheets…");
        b.Feed(drawing, 0, doc);
        var pdf = b.RenderPDF(Document: drawing, Name: "lamella-pavilion-drawings", nick: "PDF");
        var oPdf = b.Output("Drawings (PDF)", pdf.Obj);
        b.Section("Drawing set", nDoc);
        return pdf.Obj;
    }
}
