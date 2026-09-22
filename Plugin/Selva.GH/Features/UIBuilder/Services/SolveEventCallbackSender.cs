using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using Grasshopper.Kernel;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.GH.Utilities.Helpers;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Posts live events from a Rhino.Compute solve to the Selva server that requested it, and
///     carries the server's answer back. Compute hands the target to the document as constants
///     (<c>SelvaEventUrl</c>, <c>SelvaSolveId</c>, <c>SelvaEventToken</c>), so nothing here is
///     configured: the solve request is the configuration.
/// </summary>
/// <remarks>
///     <para>
///         The solver thread only ever enqueues. A timer thread flushes the queue every
///         <see cref="FlushMs" /> as one POST, and posts an empty heartbeat every
///         <see cref="HeartbeatMs" /> so the reply channel stays open even when nothing is
///         emitting. A solve shorter than the flush window therefore produces no traffic at all
///         beyond a single flush at solution end, and only if something was emitted.
///     </para>
///     <para>
///         The reply is the way back in: <c>{ "abort": true }</c> calls
///         <see cref="GH_Document.RequestAbortSolution" />, which only sets a flag the solver
///         checks between components, so doing it from the timer thread is safe. Any non-2xx reply
///         ends the session: the server no longer knows this solve, and an aborted solution never
///         reaches <c>SolutionEnd</c> to end it here.
///     </para>
///     <para>
///         One session at a time. compute.geometry holds a process-wide solve lock, so a second
///         solve cannot interleave with the first; a different <c>SelvaSolveId</c> simply replaces
///         the session.
///     </para>
/// </remarks>
internal static class SolveEventCallbackSender
{
    private const int FlushMs = 50;
    private const int HeartbeatMs = 500;
    private const int MaxQueued = 256;

    private const string UrlConstant = "SelvaEventUrl";
    private const string SolveIdConstant = "SelvaSolveId";
    private const string TokenConstant = "SelvaEventToken";

    private static readonly HttpClient Client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    private static readonly object Gate = new object();
    private static readonly HashSet<Guid> HookedDocuments = new HashSet<Guid>();

    private static Session _session;

    private sealed class Session
    {
        public string Url;
        public string SolveId;
        public string Token;
        public GH_Document Document;
        public int Seq;
        public readonly List<SolveEvent> Queue = new List<SolveEvent>();
        public Timer Timer;
        public DateTime LastPostUtc;
        public bool Ended;
    }

    public static void EnsureHooked(GH_Document document)
    {
        lock (Gate)
        {
            EnsureSessionLocked(document);
        }
    }

    public static void Emit(GH_Document document, string type, Dictionary<string, object> payload)
    {
        lock (Gate)
        {
            var session = EnsureSessionLocked(document);
            if (session == null) return;

            if (session.Queue.Count >= MaxQueued)
            {
                // Progress-class chatter is the only thing that can fill the queue; a
                // diagnostic is never the one dropped.
                var victim = session.Queue.FindIndex(e => e.Type != "diagnostic");
                if (victim < 0) return;
                session.Queue.RemoveAt(victim);
            }

            session.Queue.Add(new SolveEvent
            {
                SolveId = session.SolveId,
                Seq = ++session.Seq,
                At = DateTime.UtcNow.ToString("o"),
                Type = type,
                Payload = payload
            });
        }
    }

    /// <summary>Caller holds <see cref="Gate" />.</summary>
    private static Session EnsureSessionLocked(GH_Document document)
    {
        if (document == null) return null;

        var url = ReadConstant(document, UrlConstant);
        var solveId = ReadConstant(document, SolveIdConstant);
        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(solveId)) return null;

        var current = _session;
        if (current != null && !current.Ended && current.SolveId == solveId)
        {
            return current;
        }

        current?.Timer?.Dispose();

        var session = new Session
        {
            Url = url,
            SolveId = solveId,
            Token = ReadConstant(document, TokenConstant),
            Document = document,
            LastPostUtc = DateTime.UtcNow
        };
        session.Timer = new Timer(_ => Tick(session), null, FlushMs, FlushMs);
        _session = session;

        // Subscribed once per document, not per solve: compute.geometry caches the live
        // GH_Document and reuses it across requests.
        if (HookedDocuments.Add(document.DocumentID))
        {
            document.SolutionEnd += OnSolutionEnd;
        }

        return session;
    }

    private static void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        Session session;
        List<SolveEvent> batch;
        lock (Gate)
        {
            session = _session;
            if (session == null || session.Ended || !ReferenceEquals(session.Document, sender)) return;
            session.Ended = true;
            session.Timer?.Dispose();
            batch = TakeQueueLocked(session);
        }

        // Nothing emitted means nothing to say: the HTTP response carries the final state.
        if (batch.Count > 0)
        {
            Post(session, batch);
        }
    }

    private static void Tick(Session session)
    {
        List<SolveEvent> batch;
        lock (Gate)
        {
            if (session.Ended) return;
            var due = (DateTime.UtcNow - session.LastPostUtc).TotalMilliseconds >= HeartbeatMs;
            if (session.Queue.Count == 0 && !due) return;
            batch = TakeQueueLocked(session);
            session.LastPostUtc = DateTime.UtcNow;
        }

        Post(session, batch);
    }

    /// <summary>Caller holds <see cref="Gate" />.</summary>
    private static List<SolveEvent> TakeQueueLocked(Session session)
    {
        var batch = session.Queue.ToList();
        session.Queue.Clear();
        return batch;
    }

    private static void Post(Session session, List<SolveEvent> batch)
    {
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

            // Timer and SolutionEnd threads, never the solver: blocking here is fine, and it keeps
            // replies ordered with the batches they answer.
            using var response = Client.SendAsync(request).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode)
            {
                End(session);
                return;
            }

            var reply = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (WantsAbort(reply))
            {
                session.Document?.RequestAbortSolution();
                End(session);
            }
        }
        catch (Exception ex)
        {
            Logger.Warn($"[SolveEventCallbackSender] Event post failed: {ex.Message}");
            End(session);
        }
    }

    private static void End(Session session)
    {
        lock (Gate)
        {
            session.Ended = true;
            session.Timer?.Dispose();
        }
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

    private static string ReadConstant(GH_Document document, string name)
    {
        try
        {
            return document.ConstantServer.TryGetValue(name, out var value) ? value._String : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
