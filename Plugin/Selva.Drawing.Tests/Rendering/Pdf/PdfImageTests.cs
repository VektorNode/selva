using System;
using System.IO;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Rendering.Pdf;

namespace Selva.Drawing.Tests.Rendering.Pdf;

public class PdfImageTests
{
    // A valid 2x2 red PNG with one half-transparent pixel, as GDI+ encodes it.
    private static readonly byte[] RedPng = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAVSURBVBhXY/jPwPD/PwNDAwOU8R8AQtQHeuat4/kAAAAASUVORK5CYII=");

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
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
        Assert.Equal(1, reopened.PageCount);
    }

    [Fact]
    public void Svg_format_is_skipped_without_throwing()
    {
        // PDFsharp can't embed SVG; renderer skips it. Should still produce a valid PDF.
        var bytes = RenderScene(new ImageElement
        {
            Data = new byte[] { 1, 2, 3 },
            Format = ImageFormat.Svg,
            Position = new Point2D(0, 0),
            Width = 10,
            Height = 10,
        });

        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
        Assert.Equal(1, reopened.PageCount);
    }

    [Fact]
    public void Only_png_and_jpeg_signatures_reach_the_decoder()
    {
        Assert.True(PdfRenderer.IsPngOrJpeg(RedPng));
        Assert.True(PdfRenderer.IsPngOrJpeg(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }));
        Assert.False(PdfRenderer.IsPngOrJpeg("RIFF\0\0\0\0WEBPVP8 "u8.ToArray()));
        Assert.False(PdfRenderer.IsPngOrJpeg("II*\0\b\0\0\0"u8.ToArray()));
        Assert.False(PdfRenderer.IsPngOrJpeg("MM\0+\0\b\0\0"u8.ToArray()));
        Assert.False(PdfRenderer.IsPngOrJpeg("GIF89a"u8.ToArray()));
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
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
        Assert.Equal(1, reopened.PageCount);
    }

    [Fact]
    public void One_image_on_every_page_is_embedded_once()
    {
        var logo = RedPng;
        Page WithLogo() => new Page
        {
            Content = new ImageElement { Data = logo, Format = ImageFormat.Png, Width = 10, Height = 10 },
        };

        // A PNG with alpha embeds as an image plus its SMask image, so compare against one page.
        int ImageObjects(params Page[] pages)
        {
            using var ms = new MemoryStream(new PdfRenderer().Render(new Document { Pages = pages }));
            using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
            return reopened.Internals.GetAllObjects().OfType<PdfDictionary>()
                .Count(d => d.Elements.GetName("/Subtype") == "/Image");
        }

        Assert.True(ImageObjects(WithLogo()) > 0);
        Assert.Equal(ImageObjects(WithLogo()), ImageObjects(WithLogo(), WithLogo(), WithLogo()));
    }

    [Fact]
    public void An_svg_only_image_is_not_embedded()
    {
        var bytes = RenderScene(new ImageElement
        {
            Data = RedPng,
            Format = ImageFormat.Png,
            SvgOnly = true,
            Width = 10,
            Height = 10,
        });

        using var ms = new MemoryStream(bytes);
        using var reopened = PdfReader.Open(ms, PdfDocumentOpenMode.Import);
        Assert.DoesNotContain(reopened.Internals.GetAllObjects().OfType<PdfDictionary>(),
            d => d.Elements.GetName("/Subtype") == "/Image");
    }
}
