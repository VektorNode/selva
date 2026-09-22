using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Selva.GH.Utilities.Guards;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     The one place a component emits a live event from inside a solve. Which wire it takes is
///     decided here, not by the caller: under the local bridge the event rides the WebSocket;
///     under Rhino.Compute it goes to the callback the solve request named (see
///     <see cref="SolveEventCallbackSender" />); in plain Grasshopper it is dropped.
/// </summary>
/// <remarks>
///     Never blocks the solver thread and never throws into a solve. Locally the send is
///     background socket I/O; on Compute it is an enqueue. Both transports keep the same rule
///     <c>SolveMessageBroadcaster</c> established: nothing here may ever wait on the browser.
///
///     Static for the same reason as the broadcaster: components are created by Grasshopper,
///     which cannot inject a bridge, and one process serves one session.
/// </remarks>
public static class SolveEventSink
{
    private static Action<SolveEvent> _localSend;
    private static string _localSolveId = "local";
    private static int _localSeq;

    /// <summary>
    ///     Points the sink at the local bridge. The lifecycle manager sets this when the
    ///     WebSocket server starts and clears it (null) on teardown.
    /// </summary>
    public static void SetLocalSender(Action<SolveEvent> send) => _localSend = send;

    /// <summary>
    ///     Called at <c>SolutionStart</c> by the bridge so local events carry a per-solution id
    ///     and a sequence that restarts at 1, matching what the Selva server stamps on Compute.
    /// </summary>
    public static void BeginLocalSolve()
    {
        _localSolveId = Guid.NewGuid().ToString("N");
        _localSeq = 0;
    }

    /// <summary>
    ///     Starts the Compute-side session early (heartbeat, abort polling) without emitting
    ///     anything. Call from a component that solves near the start of the graph, so an abort
    ///     can reach a definition that never emits. No-op outside Compute.
    /// </summary>
    public static void EnsureHooked(GH_Document document)
    {
        if (document == null || _localSend != null) return;
        if (!HeadlessGuard.IsHeadless) return;
        SolveEventCallbackSender.EnsureHooked(document);
    }

    public static void Emit(GH_Document document, string type, Dictionary<string, object> payload)
    {
        if (document == null || string.IsNullOrEmpty(type)) return;

        var local = _localSend;
        if (local != null)
        {
            var seq = System.Threading.Interlocked.Increment(ref _localSeq);
            try
            {
                local(new SolveEvent
                {
                    SolveId = _localSolveId,
                    Seq = seq,
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
        SolveEventCallbackSender.Emit(document, type, payload);
    }

    /// <summary>Payload for a <c>diagnostic</c> event, shaped like the outputs envelope's entries.</summary>
    public static Dictionary<string, object> DiagnosticPayload(SolveDiagnostic diagnostic) =>
        new Dictionary<string, object>
        {
            ["level"] = diagnostic.Level,
            ["message"] = diagnostic.Message,
            ["source"] = diagnostic.Source,
            ["isGate"] = diagnostic.IsGate
        };
}
