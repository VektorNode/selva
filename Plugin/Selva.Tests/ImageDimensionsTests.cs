using System;
using System.Text;
using Selva.Drawing.Model.Elements;
using Selva.GH.Features.FileIO.Services;

namespace Selva.Tests;

public class ImageDimensionsTests
{
    [Fact]
    public void Reads_png_dimensions_from_ihdr()
    {
        // PNG signature + IHDR chunk declaring 40x20.
        var png = new byte[24];
        new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }.CopyTo(png, 0);
        Encoding.ASCII.GetBytes("IHDR").CopyTo(png, 12);
        WriteUInt32Be(png, 16, 40);
        WriteUInt32Be(png, 20, 20);

        Assert.True(ImageDimensions.TryGet(png, ImageFormat.Png, out var w, out var h));
        Assert.Equal(40, w);
        Assert.Equal(20, h);
    }

    [Fact]
    public void Reads_jpeg_dimensions_from_sof0()
    {
        // SOI, then an SOF0 (0xFFC0) segment with height=30, width=50.
        var jpeg = new byte[]
        {
            0xFF, 0xD8,             // SOI
            0xFF, 0xC0, 0x00, 0x11, // SOF0, length 17
            0x08,                   // precision
            0x00, 0x1E,             // height = 30
            0x00, 0x32,             // width  = 50
            0x03,                   // components
            0, 0, 0, 0, 0, 0, 0, 0, 0,
        };

        Assert.True(ImageDimensions.TryGet(jpeg, ImageFormat.Jpeg, out var w, out var h));
        Assert.Equal(50, w);
        Assert.Equal(30, h);
    }

    [Fact]
    public void Reads_svg_dimensions_from_width_height_attrs()
    {
        var svg = Encoding.UTF8.GetBytes("<svg xmlns='...' width='120px' height='60px'></svg>");
        Assert.True(ImageDimensions.TryGet(svg, ImageFormat.Svg, out var w, out var h));
        Assert.Equal(120, w);
        Assert.Equal(60, h);
    }

    [Fact]
    public void Falls_back_to_svg_viewbox_when_no_width_height()
    {
        var svg = Encoding.UTF8.GetBytes("<svg xmlns='...' viewBox='0 0 200 100'></svg>");
        Assert.True(ImageDimensions.TryGet(svg, ImageFormat.Svg, out var w, out var h));
        Assert.Equal(200, w);
        Assert.Equal(100, h);
    }

    [Fact]
    public void Percentage_svg_width_is_not_usable()
    {
        // width=100% is not an intrinsic size; with no viewBox there's nothing to use.
        var svg = Encoding.UTF8.GetBytes("<svg xmlns='...' width='100%' height='100%'></svg>");
        Assert.False(ImageDimensions.TryGet(svg, ImageFormat.Svg, out _, out _));
    }

    [Fact]
    public void Returns_false_for_garbage()
    {
        Assert.False(ImageDimensions.TryGet(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9 }, ImageFormat.Png, out _, out _));
    }

    private static void WriteUInt32Be(byte[] d, int offset, uint v)
    {
        d[offset] = (byte)(v >> 24);
        d[offset + 1] = (byte)(v >> 16);
        d[offset + 2] = (byte)(v >> 8);
        d[offset + 3] = (byte)v;
    }
}
