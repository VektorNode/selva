using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Expressions;
using Newtonsoft.Json;
using Selva.GH.Features.SolveRuntime.Components;
using Selva.GH.Utilities.Guards;
using Selva.Schema.Constants;
using Selva.Schema.Models;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Everything that happens during one document's solves: the solve id, live events, the
///     abort and the verdict. Which wire an event takes is decided here, not by the emitter:
///     under the local bridge it rides the WebSocket; under Rhino.Compute it goes to the callback
///     the solve request named; in plain Grasshopper it is dropped.
/// </summary>
/// <remarks>
///     Never blocks the solver thread mid-solve and never throws into a solve. Nothing here may
///     wait on the browser: locally, inbound frames are dispatched on the UI thread the solver
///     occupies, so a wait would deadlock Rhino.
/// </remarks>
public sealed class DocumentSolveRuntime
{
    private const string UrlConstant = "SelvaEventUrl";
    private const string SolveIdConstant = "SelvaSolveId";
    private const string TokenConstant = "SelvaEventToken";

    /// <summary>
    ///     Where the verdict goes on Rhino.Compute. The fork defines it empty on every request and
    ///     reads it back after the solve; a server that never defines it never gets one written.
    /// </summary>
    private const string OutcomeConstant = "SelvaOutcome";

    private readonly GH_Document _document;
    private readonly ComputeCallbackTransport _compute;

    private string _localSolveId = "local";
    private int _localSeq;

    // The finished solution's verdict, collected once. Cleared at SolutionStart.
    private SolveDiagnostics _verdict;

    private readonly StepProgress _steps = new StepProgress();
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    /// <summary>The one bar Report Progress components share.</summary>
    private const string StepsSource = "steps";

    internal DocumentSolveRuntime(GH_Document document)
    {
        _document = document;
        _compute = new ComputeCallbackTransport(document.RequestAbortSolution);

        // Subscribed once per document, not per solve: compute.geometry caches the live
        // GH_Document and reuses it across requests. Never unsubscribed; the runtime lives
        // exactly as long as the document does.
        document.SolutionStart += OnSolutionStart;
        document.SolutionEnd += OnSolutionEnd;
    }

    /// <summary>
    ///     Starts the Compute-side session early (heartbeat, abort polling) without emitting
    ///     anything, so an abort can reach a definition that never emits. No-op outside Compute.
    /// </summary>
    public void EnsureHooked()
    {
        if (SolveRuntimes.LocalTransport != null || !HeadlessGuard.IsHeadless) return;
        _compute.EnsureSession(ReadCallbackTarget());
    }

    public void EmitDiagnostic(SolveDiagnostic diagnostic) =>
        Emit(SolveEventKinds.Diagnostic, new Dictionary<string, object>
        {
            ["level"] = diagnostic.Level,
            ["message"] = diagnostic.Message,
            ["source"] = diagnostic.Source,
            ["isGate"] = diagnostic.IsGate ?? false
        });

    /// <param name="source">One bar per source; a newer report from the same source replaces the older.</param>
    /// <param name="fraction">0..1, or null when the total is unknown.</param>
    public void EmitProgress(string source, double? fraction, int? done = null, int? total = null,
        string label = null) =>
        Emit(SolveEventKinds.Progress, ProgressFields(source, fraction, done, total, label));

    private static Dictionary<string, object> ProgressFields(string source, double? fraction, int? done,
        int? total, string label)
    {
        var payload = new Dictionary<string, object>();
        if (source != null) payload["source"] = source;
        if (fraction.HasValue) payload["fraction"] = Math.Max(0, Math.Min(1, fraction.Value));
        if (done.HasValue) payload["done"] = done.Value;
        if (total.HasValue) payload["total"] = total.Value;
        if (label != null) payload["label"] = label;
        return payload;
    }

    /// <summary>Called by a Report Progress component when it runs.</summary>
    /// <param name="skipped">It got no data, so the step it describes will not run either.</param>
    public void ReportStep(Guid reporterId, string message, bool skipped)
    {
        var snapshot = _steps.Step(reporterId, message, skipped, _clock.ElapsedMilliseconds);
        if (snapshot is not StepProgress.Snapshot s) return;
        var payload = ProgressFields(StepsSource, s.Fraction, s.Step, s.Total, s.Label);
        payload["nextFraction"] = s.NextFraction;
        if (s.StepMs.HasValue) payload["stepMs"] = s.StepMs.Value;
        Emit(SolveEventKinds.Progress, payload);
    }

    /// <summary>
    ///     Sends an event of any kind. Prefer a typed emitter: this one leaves the payload shape
    ///     to the caller, and the known kinds' shapes are fixed by <c>wire-schema.json</c>.
    /// </summary>
    public void Emit(string type, Dictionary<string, object> payload)
    {
        if (string.IsNullOrEmpty(type)) return;

        var local = SolveRuntimes.LocalTransport;
        if (local != null)
        {
            try
            {
                local(new SolveEvent
                {
                    SolveId = _localSolveId,
                    Seq = Interlocked.Increment(ref _localSeq),
                    At = DateTime.UtcNow.ToString("o"),
                    Type = type,
                    Payload = payload
                });
            }
            catch (Exception)
            {
                // A dead socket must not take down the solution that is reporting through it.
            }

            return;
        }

        if (!HeadlessGuard.IsHeadless) return;
        _compute.Emit(ReadCallbackTarget(), type, payload);
    }

    /// <summary>
    ///     Only sets a flag the solver polls between components, so it is safe from any thread,
    ///     and must be called from the socket thread rather than marshalled: the solver holds the
    ///     UI thread, and a marshalled abort would wait for the solve it is meant to stop.
    /// </summary>
    public void RequestAbort() => _document.RequestAbortSolution();

    /// <summary>
    ///     What the last finished solution reported, and whether its outputs may be shown.
    ///     Collected on first ask after SolutionEnd and kept until the next solution starts, so
    ///     the live <c>solveEnded</c>, the outputs envelope and Compute's constant agree.
    /// </summary>
    public SolveDiagnostics Verdict() => _verdict ??= SolveDiagnosticsCollector.CollectVerdict(_document);

    private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
    {
        // Local events carry a per-solution id and a sequence that restarts at 1, matching what
        // the Selva server stamps on Compute.
        _localSolveId = Guid.NewGuid().ToString("N");
        Interlocked.Exchange(ref _localSeq, 0);
        _verdict = null;

        // A step re-runs whenever any of its inputs changed, not only the one its reporter sits on
        // (a delay slider feeding the step directly). Re-run that reporter too, or the step runs
        // unnamed and missing from the bar. A reporter is a pass-through, so this costs nothing.
        var reporters = _document.Objects.OfType<GH_ReportProgress>().ToList();
        foreach (var reporter in reporters)
        {
            if (reporter.Phase == GH_SolutionPhase.Blank) continue;
            var stepExpired = reporter.Params.Output
                .SelectMany(p => p.Recipients)
                .Any(r => r.Attributes?.GetTopLevel?.DocObject is IGH_ActiveObject step
                          && step.Phase == GH_SolutionPhase.Blank);
            if (stepExpired) reporter.ExpireSolution(false);
        }

        // Expired now means it will run this solution; the rest keep last solution's data.
        _steps.Begin(reporters
            .Where(r => r.Phase == GH_SolutionPhase.Blank)
            .Select(r => r.InstanceGuid));

        // On Compute the Selva server emits start and end itself: it knows about the solve
        // before Grasshopper does (queueing) and after (a failed request).
        if (SolveRuntimes.LocalTransport != null)
        {
            Emit(SolveEventKinds.SolveStarted, new Dictionary<string, object>());
        }
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        _steps.End(_clock.ElapsedMilliseconds, learn: !_document.AbortRequested);

        if (SolveRuntimes.LocalTransport != null)
        {
            Emit(SolveEventKinds.SolveEnded, new Dictionary<string, object> { ["kind"] = Verdict().EndedKind });
            return;
        }

        if (!HeadlessGuard.IsHeadless) return;
        _compute.OnSolutionEnd();
        WriteOutcomeConstant();
    }

    private void WriteOutcomeConstant()
    {
        try
        {
            if (!_document.ConstantServer.ContainsKey(OutcomeConstant)) return;
            var json = JsonConvert.SerializeObject(Verdict().ToOutcome());
            _document.DefineConstant(OutcomeConstant, new GH_Variant(json));
        }
        catch (Exception)
        {
            // The response then carries no outcome and the client falls back to the markers.
        }
    }

    /// <summary>
    ///     Null when this solve named no callback. The fork defines all three constants on every
    ///     request, empty when absent, so a reused document never carries a previous request's.
    /// </summary>
    private CallbackTarget ReadCallbackTarget()
    {
        var url = ReadConstant(UrlConstant);
        var solveId = ReadConstant(SolveIdConstant);
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(solveId)) return null;
        return new CallbackTarget { Url = url, SolveId = solveId, Token = ReadConstant(TokenConstant) };
    }

    private string ReadConstant(string name)
    {
        try
        {
            return _document.ConstantServer.TryGetValue(name, out var value) ? value._String : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
