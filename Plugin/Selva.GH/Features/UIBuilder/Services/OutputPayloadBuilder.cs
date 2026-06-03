using System;
using System.Collections.Generic;
using Selva.GH.Features.ComputeIO.Goos;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     A Rhino/GH-free view of a single goo sitting on a ContextBake input, reduced to the facts the
///     payload decision needs. The Rhino-typed <see cref="ValueCollector" /> unwraps GH_ObjectWrapper
///     and projects each goo into one of these; <see cref="OutputPayloadBuilder" /> then decides the
///     payload. Splitting the unwrap (untestable) from the decision (pure) is what makes the
///     output contract unit-testable without a Grasshopper runtime.
/// </summary>
public sealed class GooView
{
    /// <summary>The goo's GH TypeName (e.g. "Plotly Figure", "Dynamic Value List", "File Data").</summary>
    public string TypeName { get; init; }

    /// <summary>Dynamic value list routing payload, when the goo is a DynamicValueListGoo; else null.</summary>
    public DynamicValueListPayload DynamicValueList { get; init; }

    /// <summary>Chart JSON (PlotlyFigure.ToJson()), when the goo is a chart; else null.</summary>
    public string ChartJson { get; init; }

    /// <summary>File payload object, when the goo is a FileDataGoo; else null.</summary>
    public object FilePayload { get; init; }

    // The fields above are optional facts; the plugin compiles without a nullable context, and the
    // test project links this file into a nullable-enabled context. The decision logic treats every
    // field as possibly-null, so the CS8618 "uninitialized" warnings are expected and harmless.
}

/// <summary>
///     Why a goo-walk over a ContextBake input did not yield a payload — or that it did. Turns the
///     three historically-silent null paths into named, testable, loggable outcomes:
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

    /// <summary>The produced payload when <see cref="Kind" /> is Matched; else null.</summary>
    public object Payload { get; init; }

    /// <summary>The classified schema type ("dynamicValueList" / "chart" / "file") when Matched; else null.</summary>
    public string OutputType { get; init; }

    /// <summary>
    ///     For diagnostics: the last observed goo TypeName. Set for both Matched and UnknownType so a
    ///     null result in Rhino prints which goo was actually sitting on the input.
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
///     The single, table-driven contract that maps a ContextBake-wired goo to the value the WebSocket
///     collector broadcasts. One branch per Selva output type. Adding a new output type means adding a
///     branch here and a row to the golden contract test — no other collection code changes.
///
///     Pure: no Rhino/GH types. Unit-tested in Selva.Tests.
/// </summary>
public static class OutputPayloadBuilder
{
    /// <summary>
    ///     Build the collector payload for one goo, or null if the goo is not a recognized Selva output.
    /// </summary>
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
    ///     Classify the goos observed on one ContextBake input into a tagged outcome. The first recognized
    ///     goo wins (Matched). If at least one goo was seen but none matched, the result is UnknownType,
    ///     carrying the last observed TypeName. An empty / all-null sequence yields Empty.
    ///
    ///     This is the testable replacement for the Rhino-walk's silent null: the adapter projects each
    ///     goo into a <see cref="GooView" /> and hands the sequence here, then logs the outcome.
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
    ///     The declared output type string (as it appears in schema.Outputs / layout items) for a goo,
    ///     or null if unrecognized. Lets the schema side and the value side agree on one classifier.
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
