using System;
using System.Collections.Generic;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Rhino/GH-free view of a single goo on a ContextBake input. The Rhino-typed <see cref="ValueCollector" />
///     unwraps GH_ObjectWrapper into one of these; <see cref="OutputPayloadBuilder" /> decides the payload from
///     it. Splitting the unwrap (untestable) from the decision (pure) makes the output contract unit-testable
///     without a Grasshopper runtime.
/// </summary>
public sealed class GooView
{
    public string TypeName { get; init; }

    /// <summary>Set when the goo is a DynamicValueListGoo; else null.</summary>
    public DynamicValueListPayload DynamicValueList { get; init; }

    /// <summary>PlotlyFigure.ToJson() when the goo is a chart; else null.</summary>
    public string ChartJson { get; init; }

    /// <summary>Set when the goo is a FileDataGoo; else null.</summary>
    public object FilePayload { get; init; }

    // Plugin compiles without a nullable context; the test project links this file in with one enabled.
    // Every field is genuinely optional, so the CS8618 warnings there are expected, not bugs.
}

/// <summary>
///     Outcome of a goo-walk over one ContextBake input — replaces three previously-silent null paths
///     with named, testable, loggable results:
///     <list type="bullet">
///         <item><see cref="Empty" /> — the bake's first input had no data (wiring / solve-order).</item>
///         <item><see cref="UnknownType" /> — a goo was present but matched no Selva output type
///               (unwrap miss, or an upstream TypeName rename).</item>
///         <item><see cref="Matched" /> — a Selva output goo was recognized and a payload produced.</item>
///     </list>
/// </summary>
public enum BuildOutcomeKind
{
    Empty,
    UnknownType,
    Matched
}

/// <summary>Tagged result of classifying the goos on one ContextBake input.</summary>
public sealed class BuildOutcome
{
    public BuildOutcomeKind Kind { get; init; }

    /// <summary>Set when <see cref="Kind" /> is Matched; else null.</summary>
    public object Payload { get; init; }

    /// <summary>Schema type ("dynamicValueList" / "chart" / "file") when Matched; else null.</summary>
    public string OutputType { get; init; }

    /// <summary>
    ///     Last observed goo TypeName, set for both Matched and UnknownType so a null result in Rhino
    ///     still logs which goo was actually on the input.
    /// </summary>
    public string ObservedTypeName { get; init; }

    public static readonly BuildOutcome EmptyResult = new() { Kind = BuildOutcomeKind.Empty };

    public override string ToString()
    {
        return Kind switch
        {
            BuildOutcomeKind.Matched => $"Matched({OutputType}, '{ObservedTypeName}')",
            BuildOutcomeKind.UnknownType => $"UnknownType('{ObservedTypeName}')",
            _ => "Empty"
        };
    }
}

/// <summary>
///     Maps a ContextBake-wired goo to the value the WebSocket collector broadcasts — one branch per
///     Selva output type. Adding an output type means adding a branch here plus a row in the golden
///     contract test; no other collection code changes.
///
///     Pure: no Rhino/GH types. Unit-tested in Selva.Tests.
/// </summary>
public static class OutputPayloadBuilder
{
    /// <summary>Collector payload for one goo, or null if it's not a recognized Selva output.</summary>
    public static object Build(GooView goo)
    {
        if (goo == null)
        {
            return null;
        }

        if (goo.DynamicValueList != null)
        {
            return goo.DynamicValueList.ToCollectorPayload();
        }

        if (goo.ChartJson != null)
        {
            return goo.ChartJson;
        }

        if (goo.FilePayload != null)
        {
            return goo.FilePayload;
        }

        return null;
    }

    /// <summary>
    ///     Classifies the goos on one ContextBake input. The first recognized goo wins (Matched). If at
    ///     least one goo was seen but none matched, the result is UnknownType, carrying the last observed
    ///     TypeName. An empty / all-null sequence yields Empty.
    /// </summary>
    public static BuildOutcome Classify(IEnumerable<GooView> views)
    {
        if (views == null)
        {
            return BuildOutcome.EmptyResult;
        }

        var sawAny = false;
        string lastTypeName = null;

        foreach (var view in views)
        {
            if (view == null)
            {
                continue;
            }

            sawAny = true;
            lastTypeName = view.TypeName;

            var payload = Build(view);
            if (payload != null)
            {
                return new BuildOutcome
                {
                    Kind = BuildOutcomeKind.Matched,
                    Payload = payload,
                    OutputType = ClassifyType(view),
                    ObservedTypeName = view.TypeName
                };
            }
        }

        return sawAny
            ? new BuildOutcome { Kind = BuildOutcomeKind.UnknownType, ObservedTypeName = lastTypeName }
            : BuildOutcome.EmptyResult;
    }

    /// <summary>
    ///     Output type string as it appears in schema.Outputs / layout items, or null if unrecognized.
    ///     Lets the schema side and the value side agree on one classifier.
    /// </summary>
    public static string ClassifyType(GooView goo)
    {
        if (goo == null)
        {
            return null;
        }

        if (goo.DynamicValueList != null)
        {
            return "dynamicValueList";
        }

        if (goo.ChartJson != null)
        {
            return "chart";
        }

        if (goo.FilePayload != null)
        {
            return "file";
        }

        return null;
    }
}
