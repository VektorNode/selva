using System.Drawing;

namespace Selva.GH.Features.UIBuilder.Helpers;

public static class ColorHex
{
    /// <summary>
    ///     Always <c>#RRGGBB</c>, which is all the page's colour input accepts. Not
    ///     <c>ColorTranslator.ToHtml</c>: that returns a known colour's name, such as "Black".
    /// </summary>
    public static string Of(Color color)
    {
        return $"#{color.R:X2}{color.G:X2}{color.B:X2}";
    }
}
