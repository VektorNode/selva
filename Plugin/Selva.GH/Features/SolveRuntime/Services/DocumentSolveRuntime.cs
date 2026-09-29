using System;
using System.Collections.Generic;
using System.Threading;
using Grasshopper.Kernel;
using Selva.GH.Utilities.Guards;
using Selva.Schema.Models;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Everything that happens during one document's solves: the solve id, live events and the
///     abort. Which wire an event takes is decided here, not by the emitter: under the local
///     bridge it rides the WebSocket; under Rhino.Compute it goes to the callback the solve
///     request named; in plain Grasshopper it is dropped.
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

    private readonly GH_Document _document;
    private readonly ComputeCallbackTransport _compute;

    private string _localSolveId = "local";
    private int _localSeq;

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

    public void EmitDiagnostic(SolveDiagnostic diagnostic) => Emit("diagnostic", diagnostic.ToEventPayload());

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

    /// <summary>What the finished solution reported, and whether its outputs may be shown.</summary>
    public SolveDiagnostics CollectVerdict() => SolveDiagnosticsCollector.CollectVerdict(_document);

    private void OnSolutionStart(object sender, GH_SolutionEventArgs e)
    {
        // Local events carry a per-solution id and a sequence that restarts at 1, matching what
        // the Selva server stamps on Compute.
        _localSolveId = Guid.NewGuid().ToString("N");
        Interlocked.Exchange(ref _localSeq, 0);
    }

    private void OnSolutionEnd(object sender, GH_SolutionEventArgs e) => _compute.OnSolutionEnd();

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
