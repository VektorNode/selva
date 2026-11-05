using System;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     How a prompt the page asked for ended: a viewport pick, or a host file save or pick. The
///     wire names are <see cref="PromptOutcomeNames.WireName" />.
/// </summary>
public enum PromptOutcome
{
    /// <summary>A viewport pick took geometry.</summary>
    Picked,

    /// <summary>A host file save wrote the file.</summary>
    Saved,

    Cancelled,
    Failed
}

internal static class PromptOutcomeNames
{
    /// <summary>The `outcome` of the host-file and pick-geometry replies; the page switches on it.</summary>
    public static string WireName(this PromptOutcome outcome) => outcome switch
    {
        PromptOutcome.Picked => "picked",
        PromptOutcome.Saved => "saved",
        PromptOutcome.Cancelled => "cancelled",
        PromptOutcome.Failed => "failed",
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, null)
    };
}
