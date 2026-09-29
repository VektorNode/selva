using System.Collections.Generic;

namespace Selva.Schema.Constants;

/// <summary>
///     How each live solve event kind may be delivered: the only per-kind rule a transport needs.
///     Hand-written because the codegen drops custom schema keywords. The TS twin is
///     <c>packages/schemas/src/solve-event-kinds.ts</c>; <c>fixtures/solve/event-kinds.json</c>
///     holds the table both test suites compare against.
/// </summary>
public static class SolveEventKinds
{
    public const string SolveStarted = "solveStarted";
    public const string SolveEnded = "solveEnded";
    public const string Diagnostic = "diagnostic";
    public const string Progress = "progress";

    /// <summary>Never dropped, never coalesced.</summary>
    public const string Critical = "critical";

    /// <summary>Only the newest per coalesce key matters; older ones may be replaced or dropped.</summary>
    public const string Latest = "latest";

    /// <summary>Dropped first under pressure. The class of every kind not in the table.</summary>
    public const string BestEffort = "bestEffort";

    public static readonly IReadOnlyDictionary<string, SolveEventKindRule> All =
        new Dictionary<string, SolveEventKindRule>
        {
            [SolveStarted] = new SolveEventKindRule(Critical),
            [SolveEnded] = new SolveEventKindRule(Critical),
            [Diagnostic] = new SolveEventKindRule(Critical),
            [Progress] = new SolveEventKindRule(Latest, "source")
        };

    public static string DeliveryOf(string type) =>
        type != null && All.TryGetValue(type, out var rule) ? rule.Delivery : BestEffort;

    /// <summary>Two <c>latest</c> events with the same key supersede each other. Null for every other class.</summary>
    public static string CoalesceKey(string type, IDictionary<string, object> payload)
    {
        if (type == null || !All.TryGetValue(type, out var rule) || rule.Delivery != Latest) return null;
        object key = null;
        if (rule.CoalesceBy != null) payload?.TryGetValue(rule.CoalesceBy, out key);
        return type + ":" + (key as string ?? string.Empty);
    }
}

public sealed class SolveEventKindRule
{
    public SolveEventKindRule(string delivery, string coalesceBy = null)
    {
        Delivery = delivery;
        CoalesceBy = coalesceBy;
    }

    public string Delivery { get; }

    /// <summary>For <c>latest</c>: the payload field that keys coalescing.</summary>
    public string CoalesceBy { get; }
}
