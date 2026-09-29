using System;
using System.Collections.Generic;
using System.Threading;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Expressions;
using Newtonsoft.Json;
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
        string label = null)
    {
        var payload = new Dictionary<string, object>();
        if (source != null) payload["source"] = source;
        if (fraction.HasValue) payload["fraction"] = Math.Max(0, Math.Min(1, fraction.Value));
        if (done.HasValue) payload["done"] = done.Value;
        if (total.HasValue) payload["total"] = total.Value;
        if (label != null) payload["label"] = label;
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

        // On Compute the Selva server emits start and end itself: it knows about the solve
        // before Grasshopper does (queueing) and after (a failed request).
        if (SolveRuntimes.LocalTransport != null)
        {
            Emit(SolveEventKinds.SolveStarted, new Dictionary<string, object>());
        }
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
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
