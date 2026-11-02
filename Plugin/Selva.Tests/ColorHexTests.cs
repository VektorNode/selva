using System.Drawing;
using Selva.GH.Features.UIBuilder.Helpers;

namespace Selva.Tests;

public class ColorHexTests
{
    [Fact]
    public void Of_WritesSixHexDigits()
    {
        Assert.Equal("#1E3E36", ColorHex.Of(Color.FromArgb(30, 62, 54)));
    }

    [Fact]
    public void Of_NeverReturnsAColourName()
    {
        Assert.Equal("#000000", ColorHex.Of(Color.Black));
    }
}
