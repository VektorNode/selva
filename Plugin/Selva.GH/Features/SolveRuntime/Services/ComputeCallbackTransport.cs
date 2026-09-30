using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Utilities.Helpers;
using Selva.Schema.Models;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>Where a Compute solve's events go, as the solve request named it.</summary>
public sealed class CallbackTarget
{
    public string Url { get; set; }
    public string SolveId { get; set; }
    public string Token { get; set; }
}

/// <summary>
///     Posts one document's live events from a Rhino.Compute solve to the Selva server that
///     requested it, and carries the server's answer back. The decisions live in
///     <see cref="CallbackSession" />; this owns the timer, the HTTP and the locking.
/// </summary>
/// <remarks>
///     <para>
///         The solver thread only ever enqueues. A one-shot timer posts the queue every
///         <see cref="FlushMs" /> and re-arms after the post returns, so at most one post is in
///         flight. The server stamps <c>seq</c> in arrival order, so overlapping posts would be
///         renumbered in whatever order the network delivered them. An empty heartbeat goes out
///         every <see cref="HeartbeatMs" /> so the reply channel stays open while nothing emits.
///     </para>
///     <para>
///         The reply is the way back in. An abort calls <c>RequestAbortSolution</c>, which only
///         sets a flag the solver checks between components, so the timer thread may call it.
///     </para>
/// </remarks>
public sealed class ComputeCallbackTransport
{
    private const int FlushMs = 50;
    private const int HeartbeatMs = 500;

    private static readonly HttpClient Client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

    private readonly Action _requestAbort;

    // Lock order is always PostLock, then Gate. PostLock is held across take-batch-and-post so
    // batches leave in the order they were taken; Gate guards the session and timer.
    private readonly object _postLock = new object();
    private readonly object _gate = new object();

    private CallbackSession _session;
    private Timer _timer;

    public ComputeCallbackTransport(Action requestAbort)
    {
        _requestAbort = requestAbort;
    }

    /// <summary>Starts (or continues) the session for this target. No-op once that solve's session ended.</summary>
    public void EnsureSession(CallbackTarget target)
    {
        lock (_gate) EnsureSessionLocked(target);
    }

    public void Emit(CallbackTarget target, string type, Dictionary<string, object> payload)
    {
        lock (_gate) EnsureSessionLocked(target)?.Enqueue(type, payload, DateTime.UtcNow);
    }

    /// <summary>
    ///     Runs on the solver thread, and waits out a post still in flight so the final batch
    ///     lands after it. That is the only way to land it before the server publishes
    ///     <c>solveEnded</c>, and it costs one round trip, only when something was emitted.
    /// </summary>
    public void OnSolutionEnd()
    {
        CallbackSession session;
        lock (_gate)
        {
            session = _session;
            if (session == null || !session.MarkSolutionEnded()) return;
            _timer?.Dispose();
            _timer = null;
        }

        lock (_postLock)
        {
            List<SolveEvent> batch;
            lock (_gate) batch = session.TakeAll();

            // Nothing emitted means nothing to say: the HTTP response carries the final state.
            if (batch.Count > 0) Post(session, batch);
        }
    }

    private CallbackSession EnsureSessionLocked(CallbackTarget target)
    {
        if (target == null) return null;

        if (_session != null && _session.SolveId == target.SolveId)
        {
            return _session.Ended ? null : _session;
        }

        _timer?.Dispose();
        var session = new CallbackSession(target.Url, target.SolveId, target.Token, DateTime.UtcNow);
        _session = session;
        _timer = new Timer(_ => Tick(session), null, FlushMs, Timeout.Infinite);
        return session;
    }

    private void Tick(CallbackSession session)
    {
        lock (_postLock)
        {
            List<SolveEvent> batch;
            lock (_gate)
            {
                if (!ReferenceEquals(session, _session)) return;
                batch = session.TakeDue(DateTime.UtcNow, HeartbeatMs);
                if (batch == null)
                {
                    RearmLocked(session);
                    return;
                }
            }

            Post(session, batch);

            lock (_gate) RearmLocked(session);
        }
    }

    /// <summary>Caller holds the gate, which is what keeps the timer undisposed here.</summary>
    private void RearmLocked(CallbackSession session)
    {
        if (!session.Ended && ReferenceEquals(session, _session)) _timer?.Change(FlushMs, Timeout.Infinite);
    }

    /// <summary>Caller holds the post lock. Blocking keeps replies ordered with the batches they answer.</summary>
    private void Post(CallbackSession session, List<SolveEvent> batch)
    {
        CallbackReplyAction action;
        try
        {
            var body = JsonConvert.SerializeObject(new { events = batch });
            using var request = new HttpRequestMessage(HttpMethod.Post, session.Url)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
            if (!string.IsNullOrEmpty(session.Token))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", session.Token);
            }

            using var response = Client.SendAsync(request).GetAwaiter().GetResult();
            var wantsAbort = response.IsSuccessStatusCode &&
                             WantsAbort(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());

            lock (_gate) action = session.OnReply((int)response.StatusCode, wantsAbort);
        }
        catch (Exception ex)
        {
            Logger.Warn($"[ComputeCallbackTransport] Event post failed: {ex.Message}");
            lock (_gate) session.OnTransportFailure();
            return;
        }

        if (action == CallbackReplyAction.AbortAndEnd) _requestAbort();
    }

    private static bool WantsAbort(string reply)
    {
        if (string.IsNullOrWhiteSpace(reply)) return false;
        try
        {
            return JObject.Parse(reply)["abort"]?.Value<bool>() == true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
