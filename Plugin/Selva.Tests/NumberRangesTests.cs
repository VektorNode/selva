using Selva.GH.Features.UIBuilder.Services;
using Selva.Schema.Models;

namespace Selva.Tests;

public class NumberRangesTests
{
    private static readonly Guid Param = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static SchemaInput Input(string paramType) =>
        new() { Id = Param, Nickname = "Count", ParamType = paramType };

    private static NumberRanges Ranges(double? min, double? max) => new(new UISchema
    {
        Inputs = [Input("number")],
        Layout = new FlatLayoutConfig
        {
            Groups =
            [
                new GroupConfig
                {
                    Id = "g", Label = "G",
                    Items =
                    [
                        new InputNumberLayoutItem
                        {
                            Id = "item", ParamId = Param,
                            Config = new NumberWidgetConfig { Minimum = min, Maximum = max }
                        }
                    ]
                }
            ]
        }
    });

    [Fact]
    public void AnIntegerAboveTheMaximum_IsClampedToIt()
    {
        var value = Ranges(0, 250).Clamp(Input("integer"), 9999L, out var clamped);

        Assert.True(clamped);
        Assert.Equal(250L, value);
    }

    [Theory]
    [InlineData(-2.0, 0.2)]
    [InlineData(1e308, 3.0)]
    [InlineData(double.PositiveInfinity, 3.0)]
    public void ANumberOutsideTheRange_IsClampedToTheBoundItCrossed(double sent, double expected)
    {
        var value = Ranges(0.2, 3).Clamp(Input("number"), sent, out var clamped);

        Assert.True(clamped);
        Assert.Equal(expected, value);
    }

    // A fractional bound would otherwise round outside the range when the integer is applied.
    [Fact]
    public void AnIntegerBound_RoundsInward()
    {
        Assert.Equal(1L, Ranges(0.5, 9.5).Clamp(Input("integer"), -4L, out _));
        Assert.Equal(9L, Ranges(0.5, 9.5).Clamp(Input("integer"), 40L, out _));
    }

    [Fact]
    public void AValueInRange_IsReturnedUnchanged()
    {
        var sent = (object)1.5;

        Assert.Same(sent, Ranges(0.2, 3).Clamp(Input("number"), sent, out var clamped));
        Assert.False(clamped);
    }

    [Fact]
    public void AnOpenEndedRange_ClampsOnlyTheSideItHas()
    {
        Assert.Equal(0.0, Ranges(0, null).Clamp(Input("number"), -1.0, out _));
        Assert.Equal(1e9, Ranges(0, null).Clamp(Input("number"), 1e9, out _));
    }

    // Validation reports these; clamping must not turn them into a valid bound.
    [Fact]
    public void ANonNumber_IsLeftForValidation()
    {
        Assert.Equal("abc", Ranges(0, 3).Clamp(Input("number"), "abc", out var clamped));
        Assert.False(clamped);
        Assert.True(double.IsNaN((double)Ranges(0, 3).Clamp(Input("number"), double.NaN, out _)));
    }

    [Fact]
    public void AnInputWithoutANumberWidget_IsNotClamped()
    {
        var unrelated = new SchemaInput { Id = Guid.NewGuid(), ParamType = "number" };

        Assert.Equal(9999.0, Ranges(0, 3).Clamp(unrelated, 9999.0, out var clamped));
        Assert.False(clamped);
    }
}
