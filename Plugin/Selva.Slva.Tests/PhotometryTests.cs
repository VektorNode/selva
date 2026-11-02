using System.Drawing;

namespace Selva.Slva.Tests;

public class PhotometryTests
{
    [Fact]
    public void BlackbodyColor_IsWarmAtIncandescentTemperatures()
    {
        var warm = Photometry.BlackbodyColor(2700);

        Assert.Equal(255, warm.R);
        Assert.True(warm.G > warm.B && warm.B > 80, warm.ToString());
    }

    [Fact]
    public void BlackbodyColor_IsNearWhiteAtDaylight()
    {
        var daylight = Photometry.BlackbodyColor(6500);

        Assert.True(daylight.R >= 245 && daylight.G >= 245 && daylight.B >= 235, daylight.ToString());
    }

    [Fact]
    public void BlackbodyColor_TurnsBlueAboveDaylight()
    {
        var sky = Photometry.BlackbodyColor(12000);

        Assert.Equal(255, sky.B);
        Assert.True(sky.R < sky.B);
    }

    [Theory]
    [InlineData(1000, 1667)]
    [InlineData(90000, 25000)]
    public void BlackbodyColor_HoldsOutOfRangeTemperatures(double kelvin, double held)
    {
        Assert.Equal(Photometry.BlackbodyColor(held), Photometry.BlackbodyColor(kelvin));
    }

    [Fact]
    public void BlackbodyColor_HasNoSeamWhereTheCurveFitsMeet()
    {
        foreach (var edge in new[] { 2222.0, 4000.0 })
        {
            var below = Photometry.BlackbodyColor(edge - 1);
            var above = Photometry.BlackbodyColor(edge + 1);
            Assert.True(Math.Abs(below.G - above.G) <= 3 && Math.Abs(below.B - above.B) <= 3,
                $"{below} / {above}");
        }
    }

    [Fact]
    public void SceneLightFromLumens_LightsADeskToAViewableLevel()
    {
        // 800 lm half a metre away, in the metres the viewer always works in. Far off 1 and the
        // desk is black or blown out.
        var irradiance = Photometry.SceneLightFromLumens(800) / (0.5 * 0.5);

        Assert.InRange(irradiance, 0.5, 3);
    }

    [Fact]
    public void AdaptedLightColor_KeepsWarmAndCoolButLessSaturated()
    {
        var warm = Photometry.AdaptedLightColor(2700);
        var cool = Photometry.AdaptedLightColor(6500);

        Assert.True(warm.R > warm.B, warm.ToString());
        Assert.True(warm.B > Photometry.BlackbodyColor(2700).B, warm.ToString());
        Assert.True(cool.B > cool.R, cool.ToString());
    }

    [Fact]
    public void AdaptedLightColor_IsWhiteAtTheAdaptedTemperature()
    {
        var neutral = Photometry.AdaptedLightColor(4000);

        Assert.Equal(Color.FromArgb(255, 255, 255), Color.FromArgb(neutral.R, neutral.G, neutral.B));
    }

    [Fact]
    public void SceneLightFromLumens_IsProportionalToFlux()
    {
        Assert.Equal(2 * Photometry.SceneLightFromLumens(800), Photometry.SceneLightFromLumens(1600), 6);
    }
}
