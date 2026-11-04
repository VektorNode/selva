using System;
using System.Drawing;

namespace Selva.Slva;

/// <summary>Light in the units a lighting spec uses, converted for the viewer.</summary>
public static class Photometry
{
    public const double MinKelvin = 1667;
    public const double MaxKelvin = 25000;

    /// <summary>The colour temperature a viewer's eye is taken to be adapted to: an evening room.</summary>
    private const double AdaptedWhiteKelvin = 4000;

    /// <summary>
    ///     Maps lux onto the viewer's exposure: a well-lit desk (about 500 lx) lands bright but not
    ///     white after tone mapping, the way a camera exposed for the room would see it.
    /// </summary>
    private const double SceneLightPerLux = 0.005;

    /// <summary>Emissive strength that matches a typical 800 lm desk lamp's look in the viewer.</summary>
    private const double LumensPerStrength = 160;

    /// <summary>
    ///     The colour of a black body at <paramref name="kelvin" />, as display sRGB with its largest
    ///     channel at 255. Follows the Planckian locus (Kim et al., 2002), so it holds from candle to
    ///     overcast sky, and it is colour only: brightness comes from the lumens.
    /// </summary>
    public static Color BlackbodyColor(double kelvin)
    {
        var (r, g, b) = LinearBlackbody(kelvin);
        return Displayed(r, g, b);
    }

    /// <summary>
    ///     The same source as an eye or camera adapted to a room sees it. Raw 2700 K is deep orange
    ///     because sRGB's white is daylight, but nobody sees a lamp-lit room that way: white-balancing
    ///     to <see cref="AdaptedWhiteKelvin" /> keeps warm warm and cool cool without tinting the room.
    /// </summary>
    public static Color AdaptedLightColor(double kelvin)
    {
        var (r, g, b) = LinearBlackbody(kelvin);
        var (whiteR, whiteG, whiteB) = LinearBlackbody(AdaptedWhiteKelvin);
        return Displayed(r / whiteR, g / whiteG, b / whiteB);
    }

    private static (double r, double g, double b) LinearBlackbody(double kelvin)
    {
        var t = Math.Max(MinKelvin, Math.Min(MaxKelvin, kelvin));
        var t2 = t * t;
        var t3 = t2 * t;
        var x = t <= 4000
            ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.179910
            : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.240390;
        var x2 = x * x;
        var x3 = x2 * x;
        var y = t <= 2222
            ? -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683
            : t <= 4000
                ? -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
                : 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;

        var bigX = x / y;
        var bigZ = (1 - x - y) / y;
        return (
            Math.Max(0, 3.2406 * bigX - 1.5372 - 0.4986 * bigZ),
            Math.Max(0, -0.9689 * bigX + 1.8758 + 0.0415 * bigZ),
            Math.Max(0, 0.0557 * bigX - 0.2040 + 1.0570 * bigZ));
    }

    private static Color Displayed(double r, double g, double b)
    {
        var peak = Math.Max(r, Math.Max(g, b));
        return Color.FromArgb(Encode(r / peak), Encode(g / peak), Encode(b / peak));
    }

    /// <summary>Emissive strength for a source of this flux.</summary>
    public static double StrengthFromLumens(double lumens)
    {
        return lumens / LumensPerStrength;
    }

    /// <summary>
    ///     A point light's intensity for the viewer. An isotropic source spreads its flux over 4π
    ///     steradians. No document units: the viewer scales every scene to metres, so candela apply
    ///     as they are.
    /// </summary>
    public static double SceneLightFromLumens(double lumens)
    {
        var candela = lumens / (4 * Math.PI);
        return candela * SceneLightPerLux;
    }

    private static int Encode(double linear)
    {
        var encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.Pow(linear, 1 / 2.4) - 0.055;
        return (int)Math.Round(Math.Max(0, Math.Min(1, encoded)) * 255);
    }
}
