using System.Linq;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Svg;

namespace Selva.Drawing.Tests.Rendering;

public class SvgImageTests
{
    // A 1x1 transparent PNG.
    private static readonly byte[] PngBytes =
    {
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    };

    private static string Render(ImageElement image)
    {
        var doc = new Document
        {
            Pages = new[]
            {
                new Page { Content = new GroupElement { Children = new DrawElement[] { image } } },
            },
        };
        return new SvgRenderer(new SvgRenderOptions { Padding = 10.0, AutoFitToContent = true }).Render(doc);
    }

    [Fact]
    public void Emits_image_with_base64_data_uri_and_dimensions()
    {
        var svg = Render(new ImageElement
        {
            Data = PngBytes,
            Format = ImageFormat.Png,
            Position = new Point2D(5, 10),
            Width = 40,
            Height = 20,
        });

        var expectedB64 = System.Convert.ToBase64String(PngBytes);
        Assert.Contains("<image", svg);
        Assert.Contains("data:image/png;base64," + expectedB64, svg);
        Assert.Contains("width='40'", svg);
        Assert.Contains("height='20'", svg);
    }

    [Fact]
    public void Counter_flips_so_image_is_upright_under_root_y_flip()
    {
        // Top edge in world space is Position.Y + Height; the local box draws via scale(1 -1).
        var svg = Render(new ImageElement
        {
            Data = PngBytes,
            Format = ImageFormat.Png,
            Position = new Point2D(5, 10),
            Width = 40,
            Height = 20,
        });

        Assert.Contains("translate(5 30) scale(1 -1)", svg);
    }

    [Fact]
    public void Svg_format_uses_svg_xml_mime()
    {
        var svg = Render(new ImageElement
        {
            Data = PngBytes,
            Format = ImageFormat.Svg,
            Position = new Point2D(0, 0),
            Width = 10,
            Height = 10,
        });

        Assert.Contains("data:image/svg+xml;base64,", svg);
    }

    [Theory]
    [InlineData(0, 10)]
    [InlineData(10, 0)]
    public void Skips_zero_or_negative_size(double width, double height)
    {
        var svg = Render(new ImageElement
        {
            Data = PngBytes,
            Format = ImageFormat.Png,
            Position = new Point2D(0, 0),
            Width = width,
            Height = height,
        });

        Assert.DoesNotContain("<image", svg);
    }

    [Fact]
    public void Skips_empty_data()
    {
        var svg = Render(new ImageElement
        {
            Data = System.Array.Empty<byte>(),
            Format = ImageFormat.Png,
            Position = new Point2D(0, 0),
            Width = 10,
            Height = 10,
        });

        Assert.DoesNotContain("<image", svg);
    }
}
