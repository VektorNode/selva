using Selva.GH.Features.UIBuilder.Services;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

public class PromptOutcomeTests
{
    // The page switches on these strings.
    [Theory]
    [InlineData(PromptOutcome.Picked, "picked")]
    [InlineData(PromptOutcome.Saved, "saved")]
    [InlineData(PromptOutcome.Cancelled, "cancelled")]
    [InlineData(PromptOutcome.Failed, "failed")]
    public void EveryOutcome_HasItsWireName(PromptOutcome outcome, string wireName)
    {
        Assert.Equal(wireName, outcome.WireName());
    }
}
