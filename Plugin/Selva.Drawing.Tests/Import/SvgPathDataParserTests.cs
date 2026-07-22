using System.Linq;
using Selva.Drawing.Import.Svg;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.Drawing.Tests.Import;

// SvgPathDataParser is internal; reached here via InternalsVisibleTo? No — Import namespace is
// internal-typed. These tests live in the same assembly only if IVT is set; if not, they go
// through SvgImporter. We test via SvgImporter to keep the parser internal.
public class SvgPathDataParserTests
{
    private static Path ParseViaImporter(string d)
    {
        var svg = $"<svg width='100' height='100'><path d='{d}'/></svg>";
        var el = new SvgImporter().Import(svg);
        // GroupElement(Y-flip) → PathElement
        return FindPath(el)!;
    }

    private static Path? FindPath(DrawElement el)
    {
        switch (el)
        {
            case PathElement p: return p.Path;
            case GroupElement g:
                return g.Children?.Select(FindPath).FirstOrDefault(x => x != null);
            default: return null;
        }
    }

    [Fact]
    public void Absolute_moveto_lineto()
    {
        var path = ParseViaImporter("M 10 20 L 30 40");
        Assert.Collection(path,
            s => Assert.Equal(new Point2D(10, 20), ((PathSegment.MoveTo)s).To),
            s => Assert.Equal(new Point2D(30, 40), ((PathSegment.LineTo)s).To));
    }

    [Fact]
    public void Relative_commands_accumulate()
    {
        var path = ParseViaImporter("m 10 10 l 5 0 l 0 5");
        Assert.Collection(path,
            s => Assert.Equal(new Point2D(10, 10), ((PathSegment.MoveTo)s).To),
            s => Assert.Equal(new Point2D(15, 10), ((PathSegment.LineTo)s).To),
            s => Assert.Equal(new Point2D(15, 15), ((PathSegment.LineTo)s).To));
    }

    [Fact]
    public void Horizontal_and_vertical_lines()
    {
        var path = ParseViaImporter("M 0 0 H 10 V 5");
        Assert.Collection(path,
            s => Assert.Equal(new Point2D(0, 0), ((PathSegment.MoveTo)s).To),
            s => Assert.Equal(new Point2D(10, 0), ((PathSegment.LineTo)s).To),
            s => Assert.Equal(new Point2D(10, 5), ((PathSegment.LineTo)s).To));
    }

    [Fact]
    public void Implicit_repeated_lineto_after_moveto()
    {
        // "M 0 0 1 1 2 2" = moveto then two implicit linetos.
        var path = ParseViaImporter("M 0 0 1 1 2 2");
        Assert.Equal(3, path.Count);
        Assert.IsType<PathSegment.MoveTo>(path[0]);
        Assert.IsType<PathSegment.LineTo>(path[1]);
        Assert.IsType<PathSegment.LineTo>(path[2]);
    }

    [Fact]
    public void Cubic_and_smooth_cubic()
    {
        var path = ParseViaImporter("M 0 0 C 1 1 2 1 3 0 S 5 -1 6 0");
        Assert.IsType<PathSegment.CubicTo>(path[1]);
        var smooth = Assert.IsType<PathSegment.CubicTo>(path[2]);
        // S reflects the previous control (2,1) about current point (3,0) → (4,-1).
        Assert.Equal(new Point2D(4, -1), smooth.Control1);
    }

    [Fact]
    public void Quadratic_elevates_to_cubic()
    {
        var path = ParseViaImporter("M 0 0 Q 1 2 2 0");
        Assert.IsType<PathSegment.CubicTo>(path[1]);
    }

    [Fact]
    public void Arc_command()
    {
        var path = ParseViaImporter("M 0 0 A 5 5 0 0 1 10 0");
        var arc = Assert.IsType<PathSegment.ArcTo>(path[1]);
        Assert.Equal(5, arc.RadiusX);
        Assert.True(arc.SweepClockwise);
        Assert.False(arc.LargeArc);
        Assert.Equal(new Point2D(10, 0), arc.To);
    }

    [Fact]
    public void Close_command()
    {
        var path = ParseViaImporter("M 0 0 L 10 0 L 10 10 Z");
        Assert.IsType<PathSegment.Close>(path[3]);
    }

    [Fact]
    public void Negative_and_packed_numbers()
    {
        // Numbers can be packed without separators: "10-5" = 10, -5.
        var path = ParseViaImporter("M0 0L10-5");
        Assert.Equal(new Point2D(10, -5), ((PathSegment.LineTo)path[1]).To);
    }
}
