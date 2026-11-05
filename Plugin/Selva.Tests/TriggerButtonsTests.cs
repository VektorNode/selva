using Selva.GH.Features.UIBuilder.Services;
using Selva.Schema.Models;

namespace Selva.Tests;

public class TriggerButtonsTests
{
    private static readonly Guid Param = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static UISchema Schema(string paramType, LayoutItemBase item) => new()
    {
        Inputs = [new SchemaInput { Id = Param, Nickname = "Go", ParamType = paramType }],
        Layout = new FlatLayoutConfig { Groups = [new GroupConfig { Id = "g", Label = "G", Items = [item] }] }
    };

    private static InputCheckboxLayoutItem Checkbox(string? displayAs) => new()
    {
        Id = "item",
        ParamId = Param,
        Config = displayAs == null ? null : new CheckboxWidgetConfig { DisplayAs = displayAs }
    };

    [Fact]
    public void ABooleanCheckboxShownAsAButton_IsAButton()
    {
        Assert.True(TriggerButtons.IsButton(Schema("boolean", Checkbox("button")), Param));
    }

    // A toggle keeps its value between solves; a press would leave it true behind the page's back.
    [Theory]
    [InlineData("checkbox")]
    [InlineData(null)]
    public void APlainCheckbox_IsNotAButton(string? displayAs)
    {
        Assert.False(TriggerButtons.IsButton(Schema("boolean", Checkbox(displayAs)), Param));
    }

    [Fact]
    public void AButtonOverANonBooleanInput_IsNotAButton()
    {
        Assert.False(TriggerButtons.IsButton(Schema("number", Checkbox("button")), Param));
    }

    [Fact]
    public void ABooleanInputLaidOutAsAnotherWidget_IsNotAButton()
    {
        var item = new InputNumberLayoutItem { Id = "item", ParamId = Param };
        Assert.False(TriggerButtons.IsButton(Schema("boolean", item), Param));
    }

    [Fact]
    public void AnInputMissingFromTheSchema_IsNotAButton()
    {
        Assert.False(TriggerButtons.IsButton(Schema("boolean", Checkbox("button")), Guid.NewGuid()));
        Assert.False(TriggerButtons.IsButton(null!, Param));
    }
}
