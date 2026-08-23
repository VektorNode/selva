using System;
using System.IO;
using PdfSharpCore.Pdf;
using PdfSharpCore.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Rendering.Pdf;

public class PdfImageTests
{
    // A valid 1x1 red PNG (decodable by ImageSharp, unlike a truncated header).
    private static readonly byte[] RedPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEUlEQVR42mP8z8BQz0AEYBxVSAUAB6oCAxELQVQAAAAASUVORK5CYII=");

    private static byte[] RenderScene(DrawElement content)
    {
        var doc = new Document { Pages = new[] { new Page { Content = content } } };
        return new PdfRenderer().Render(doc);
    }

    [Fact]
    public void Raster_image_renders_and_reopens()
    {
        var bytes = RenderScene(new ImageElement
        {
            Data = RedPng,
            Format = ImageFormat.Png,
            Position = new Point2D(10, 10),
            Width = 40,
            Height = 30,
        });

        Assert.True(bytes.Length > 4);
        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
        Assert.Equal(1, reopened.PageCount);
    }

    [Fact]
    public void Svg_format_is_skipped_without_throwing()
    {
        // PdfSharpCore can't embed SVG; renderer skips it. Should still produce a valid PDF.
        var bytes = RenderScene(new ImageElement
        {
            Data = new byte[] { 1, 2, 3 },
            Format = ImageFormat.Svg,
            Position = new Point2D(0, 0),
            Width = 10,
            Height = 10,
        });

        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
        Assert.Equal(1, reopened.PageCount);
    }

    [Fact]
    public void Corrupt_data_is_skipped_without_throwing()
    {
        var bytes = RenderScene(new ImageElement
        {
            Data = new byte[] { 0xDE, 0xAD, 0xBE, 0xEF },
            Format = ImageFormat.Png,
            Position = new Point2D(0, 0),
            Width = 10,
            Height = 10,
        });

        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.InformationOnly);
        Assert.Equal(1, reopened.PageCount);
    }
}
