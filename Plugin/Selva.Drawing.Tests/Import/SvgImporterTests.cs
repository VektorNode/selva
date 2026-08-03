using System.Linq;
using System.Text;
using Selva.Drawing.Import.Svg;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Svg;

namespace Selva.Drawing.Tests.Import;

public class SvgImporterTests
{
    private static DrawElement Import(string svg) => new SvgImporter().Import(svg);

    private static string ImportAndRenderSvg(string svg)
    {
        var el = Import(svg);
        var doc = new Selva.Drawing.Model.Document
        {
            Pages = new[] { new Selva.Drawing.Model.Page { Content = el ?? new GroupElement() } },
        };
        return new SvgRenderer(new SvgRenderOptions { Padding = 0, AutoFitToContent = true }).Render(doc);
    }

    [Fact]
    public void Imports_a_rect_as_a_path()
    {
        var el = Import("<svg width='100' height='100'><rect x='10' y='20' width='30' height='40'/></svg>");
        Assert.NotNull(el);
        Assert.Contains(Flatten(el), e => e is PathElement);
    }

    [Fact]
    public void Imports_path_with_curves_and_renders_to_svg()
    {
        var svg = "<svg width='100' height='100'><path d='M10 10 C 20 20, 40 20, 50 10 L 50 50 Z'/></svg>";
        var output = ImportAndRenderSvg(svg);
        Assert.Contains("<path", output);
        Assert.Contains(" C ", output);
    }

    [Fact]
    public void Parses_fill_and_stroke_from_presentation_attributes()
    {
        var el = Import("<svg width='10' height='10'><rect width='10' height='10' fill='#ff0000' stroke='blue' stroke-width='2'/></svg>");
        var path = Flatten(el).OfType<PathElement>().Single();
        Assert.NotNull(path.Fill);
        Assert.Equal(1f, path.Fill.Color.R, 3);
        Assert.Equal(0f, path.Fill.Color.G, 3);
        Assert.NotNull(path.Stroke);
        Assert.Equal(2.0, path.Stroke.Width);
    }

    [Fact]
    public void Fill_none_yields_no_fill()
    {
        var el = Import("<svg width='10' height='10'><rect width='10' height='10' fill='none' stroke='black'/></svg>");
        var path = Flatten(el).OfType<PathElement>().Single();
        Assert.Null(path.Fill);
        Assert.NotNull(path.Stroke);
    }

    [Fact]
    public void Reads_style_attribute_with_precedence()
    {
        var el = Import("<svg width='10' height='10'><rect width='10' height='10' fill='red' style='fill:#00ff00'/></svg>");
        var path = Flatten(el).OfType<PathElement>().Single();
        Assert.Equal(1f, path.Fill.Color.G, 3); // style wins -> green
        Assert.Equal(0f, path.Fill.Color.R, 3);
    }

    [Fact]
    public void Skips_unsupported_elements_and_warns()
    {
        var importer = new SvgImporter();
        importer.Import("<svg width='10' height='10'><text x='0' y='0'>hi</text><rect width='10' height='10'/></svg>");
        Assert.Contains(importer.Warnings, w => w.Contains("text"));
    }

    [Fact]
    public void Groups_apply_transforms()
    {
        var el = Import("<svg width='100' height='100'><g transform='translate(10 20)'><rect x='0' y='0' width='5' height='5'/></g></svg>");
        Assert.NotNull(el);
        Assert.Contains(Flatten(el), e => e is PathElement);
    }

    [Fact]
    public void Throws_on_non_svg_root()
    {
        Assert.Throws<System.FormatException>(() => Import("<html></html>"));
    }

    [Fact]
    public void Empty_or_whitespace_returns_null()
    {
        Assert.Null(Import(""));
        Assert.Null(Import("   "));
    }

    private static System.Collections.Generic.IEnumerable<DrawElement> Flatten(DrawElement el)
    {
        if (el == null) yield break;
        yield return el;
        if (el is GroupElement g && g.Children != null)
        {
            foreach (var c in g.Children)
                foreach (var inner in Flatten(c))
                    yield return inner;
        }
    }
}
