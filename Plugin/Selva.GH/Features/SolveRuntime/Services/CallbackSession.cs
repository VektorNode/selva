using System;
using System.Collections.Generic;
using System.Linq;
using Selva.Schema.Constants;
using Selva.Schema.Models;

namespace Selva.GH.Features.SolveRuntime.Services;

public enum CallbackReplyAction
{
    Continue,
    End,

    /// <summary>Abort the running solution, then end. Never returned after SolutionEnd.</summary>
    AbortAndEnd
}

/// <summary>
///     The event queue and lifecycle of one Compute solve's callback: what to post, when, and
///     what a reply means. Rhino-free, so every decision here is tested headless;
///     <see cref="ComputeCallbackTransport" /> owns the timer, the HTTP and the locking.
/// </summary>
/// <remarks>
///     Not thread-safe: the transport serializes every call.
/// </remarks>
public sealed class CallbackSession
{
    public const int MaxQueued = 256;

    private readonly List<SolveEvent> _queue = new List<SolveEvent>();
    private int _seq;
    private DateTime _lastPostUtc;

    public CallbackSession(string url, string solveId, string token, DateTime nowUtc)
    {
        Url = url;
        SolveId = solveId;
        Token = token;
        _lastPostUtc = nowUtc;
    }

    public string Url { get; }
    public string SolveId { get; }
    public string Token { get; }

    /// <summary>Final for this solveId: an ended session is never restarted.</summary>
    public bool Ended { get; private set; }

    public bool ReachedSolutionEnd { get; private set; }

    public int QueuedCount => _queue.Count;

    public void Enqueue(string type, Dictionary<string, object> payload, DateTime nowUtc)
    {
        if (Ended) return;

        // A newer `latest` event supersedes a queued one with the same key: a component
        // reporting progress per item would otherwise fill the queue with stale fractions.
        var key = SolveEventKinds.CoalesceKey(type, payload);
        if (key != null)
        {
            _queue.RemoveAll(e => SolveEventKinds.CoalesceKey(e.Type, e.Payload) == key);
        }

        if (_queue.Count >= MaxQueued)
        {
            var delivery = SolveEventKinds.DeliveryOf(type);
            var victim = FindVictim(delivery);
            if (victim < 0) return;
            _queue.RemoveAt(victim);
        }

        _queue.Add(new SolveEvent
        {
            SolveId = SolveId,
            Seq = ++_seq,
            At = nowUtc.ToString("o"),
            Type = type,
            Payload = payload
        });
    }

    /// <summary>
    ///     The oldest queued event that may make room for one of <paramref name="incoming" />
    ///     class: bestEffort goes first, then latest. A critical event is never the victim, and a
    ///     non-critical one never displaces anything of a higher class. -1 when nothing may go.
    /// </summary>
    private int FindVictim(string incoming)
    {
        var bestEffort = _queue.FindIndex(e => SolveEventKinds.DeliveryOf(e.Type) == SolveEventKinds.BestEffort);
        if (bestEffort >= 0) return bestEffort;
        if (incoming == SolveEventKinds.BestEffort) return -1;
        var latest = _queue.FindIndex(e => SolveEventKinds.DeliveryOf(e.Type) == SolveEventKinds.Latest);
        return latest;
    }

    /// <summary>
    ///     The batch a flush tick should post, or null when there is nothing to say yet. An empty
    ///     batch is a heartbeat: it keeps the reply channel, and so abort, open while nothing
    ///     emits.
    /// </summary>
    public List<SolveEvent> TakeDue(DateTime nowUtc, int heartbeatMs)
    {
        if (Ended) return null;
        var heartbeatDue = (nowUtc - _lastPostUtc).TotalMilliseconds >= heartbeatMs;
        if (_queue.Count == 0 && !heartbeatDue) return null;
        _lastPostUtc = nowUtc;
        return TakeAll();
    }

    /// <summary>False when the session had already ended, so there is no final flush to send.</summary>
    public bool MarkSolutionEnded()
    {
        if (Ended) return false;
        Ended = true;
        ReachedSolutionEnd = true;
        return true;
    }

    public List<SolveEvent> TakeAll()
    {
        var batch = _queue.ToList();
        _queue.Clear();
        return batch;
    }

    /// <param name="statusCode">HTTP status of the reply.</param>
    /// <param name="wantsAbort">The 2xx reply body carried <c>{ "abort": true }</c>.</param>
    public CallbackReplyAction OnReply(int statusCode, bool wantsAbort)
    {
        var success = statusCode >= 200 && statusCode < 300;
        if (success && !wantsAbort) return CallbackReplyAction.Continue;

        // 410: the server closed this solve because its requester is gone (cancelled, timed
        // out, disconnected). Nobody will read the result, so it is an abort like any other.
        var abort = success ? wantsAbort : statusCode == 410;
        Ended = true;

        // After SolutionEnd there is nothing left to stop, and a flag left set would read as an
        // aborted solve to anything checking AbortRequested before the next NewSolution.
        return abort && !ReachedSolutionEnd ? CallbackReplyAction.AbortAndEnd : CallbackReplyAction.End;
    }

    public void OnTransportFailure() => Ended = true;
}
