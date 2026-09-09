using System;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Lets an aborting component report its own solve result, without holding a reference to the
///     bridge.
/// </summary>
/// <remarks>
///     The Message component aborts the solution on an error, and an aborted solution never
///     reaches <c>SolutionEnd</c> — so the bridge's usual post-solve collection never runs. Without
///     this the browser would see a solve that simply stopped: no diagnostics, no `blocked` flag,
///     and therefore no dialog. The component sends the blocked envelope itself, then aborts.
///
///     It must be the same <c>outputs</c> envelope the normal path sends, not a
///     <c>runtimeMessage</c>: only <c>outputs</c> carries `blocked`, and only `blocked` opens the
///     dialog. A runtimeMessage raises a toast and nothing more.
///
///     Sending from inside <c>SolveInstance</c> is safe: the transport's broadcast is socket I/O on
///     a background thread and never marshals to the UI thread the solver is occupying. The reverse
///     is not true — nothing here may ever *wait* on the browser. Inbound frames are dispatched via
///     <c>RhinoApp.InvokeOnUiThread</c>, so blocking the solver for a reply would queue that reply
///     behind the solve that is waiting for it and deadlock Rhino.
///
///     A static hook rather than a constructor parameter: components are created by Grasshopper,
///     which has no way to inject the bridge. One bridge per Rhino process serves one session, so a
///     single slot matches the lifetime the transport already has.
/// </remarks>
public static class SolveMessageBroadcaster
{
    private static Action<SolveDiagnostics> _send;

    /// <summary>
    ///     Points the broadcaster at a live transport. The bridge sets this when its servers start
    ///     and clears it (null) on teardown, so a message raised with no bridge is a silent no-op
    ///     rather than a crash — a definition must keep solving in plain Grasshopper.
    /// </summary>
    public static void SetSender(Action<SolveDiagnostics> send) => _send = send;

    /// <summary>
    ///     Reports a blocked solve: the message, and no outputs. Fire-and-forget — never throws
    ///     into a solve, never waits on the browser.
    /// </summary>
    public static void SendBlocked(string message, string source)
    {
        var send = _send;
        if (send == null)
        {
            return;
        }

        var diagnostics = new SolveDiagnostics { Blocked = true };
        diagnostics.Messages.Add(new SolveDiagnostic
        {
            Level = "error",
            Message = message,
            Source = source,
            IsGate = true
        });

        try
        {
            send(diagnostics);
        }
        catch (Exception)
        {
            // A dead socket must not take down the solution that is reporting through it.
        }
    }
}
