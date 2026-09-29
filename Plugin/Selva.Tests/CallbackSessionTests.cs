using System;
using System.Collections.Generic;
using Selva.GH.Features.SolveRuntime.Services;

namespace Selva.Tests;

/// <summary>
///     The Compute callback's queue and lifecycle. The transport around it only adds a timer,
///     HTTP and locking, so these are the decisions that reach a running solve.
/// </summary>
public class CallbackSessionTests
{
    private const int HeartbeatMs = 500;
    private static readonly DateTime T0 = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    private static CallbackSession NewSession() => new CallbackSession("http://selva/cb", "solve-1", "tok", T0);

    // -------------------------------------------------------------------------
    // Flushing
    // -------------------------------------------------------------------------

    [Fact]
    public void TakeDue_NothingQueued_BeforeHeartbeat_ReturnsNull()
    {
        var session = NewSession();
        Assert.Null(session.TakeDue(T0.AddMilliseconds(100), HeartbeatMs));
    }

    [Fact]
    public void TakeDue_NothingQueued_AfterHeartbeat_ReturnsEmptyBatch()
    {
        var session = NewSession();
        var batch = session.TakeDue(T0.AddMilliseconds(HeartbeatMs), HeartbeatMs);
        Assert.NotNull(batch);
        Assert.Empty(batch);
    }

    [Fact]
    public void TakeDue_ReturnsQueuedEventsInOrder_WithSequenceFromOne()
    {
        var session = NewSession();
        session.Enqueue("diagnostic", null, T0);
        session.Enqueue("progress", null, T0);

        var batch = session.TakeDue(T0.AddMilliseconds(10), HeartbeatMs);

        Assert.Equal(new[] { 1, 2 }, batch.ConvertAll(e => (int)e.Seq));
        Assert.All(batch, e => Assert.Equal("solve-1", e.SolveId));
        Assert.Equal(0, session.QueuedCount);
    }

    [Fact]
    public void Enqueue_Full_DropsOldestNonDiagnostic()
    {
        var session = NewSession();
        session.Enqueue("diagnostic", null, T0);
        for (var i = 1; i < CallbackSession.MaxQueued; i++) session.Enqueue("progress", null, T0);

        session.Enqueue("diagnostic", null, T0);

        var batch = session.TakeAll();
        Assert.Equal(CallbackSession.MaxQueued, batch.Count);
        Assert.Equal("diagnostic", batch[0].Type);
        Assert.Equal(3, batch[1].Seq); // seq 2, the oldest progress event, was dropped
        Assert.Equal("diagnostic", batch[batch.Count - 1].Type);
    }

    [Fact]
    public void Enqueue_FullOfDiagnostics_DropsTheNewEvent()
    {
        var session = NewSession();
        for (var i = 0; i < CallbackSession.MaxQueued; i++) session.Enqueue("diagnostic", null, T0);

        session.Enqueue("progress", null, T0);

        Assert.Equal(CallbackSession.MaxQueued, session.QueuedCount);
    }

    // -------------------------------------------------------------------------
    // Replies
    // -------------------------------------------------------------------------

    [Fact]
    public void OnReply_Ok_Continues()
    {
        var session = NewSession();
        Assert.Equal(CallbackReplyAction.Continue, session.OnReply(200, wantsAbort: false));
        Assert.False(session.Ended);
    }

    [Fact]
    public void OnReply_AbortWhileRunning_AbortsAndEnds()
    {
        var session = NewSession();
        Assert.Equal(CallbackReplyAction.AbortAndEnd, session.OnReply(200, wantsAbort: true));
        Assert.True(session.Ended);
    }

    [Fact]
    public void OnReply_GoneWhileRunning_AbortsAndEnds()
    {
        // The requester cancelled or timed out; the child must not keep solving for nobody.
        var session = NewSession();
        Assert.Equal(CallbackReplyAction.AbortAndEnd, session.OnReply(410, wantsAbort: false));
    }

    [Theory]
    [InlineData(401)]
    [InlineData(500)]
    public void OnReply_OtherFailure_EndsWithoutAbort(int status)
    {
        // A misconfigured server must not abort every solve.
        var session = NewSession();
        Assert.Equal(CallbackReplyAction.End, session.OnReply(status, wantsAbort: false));
        Assert.True(session.Ended);
    }

    [Fact]
    public void OnReply_AfterSolutionEnd_NeverAborts()
    {
        var session = NewSession();
        session.MarkSolutionEnded();
        Assert.Equal(CallbackReplyAction.End, session.OnReply(410, wantsAbort: false));
        Assert.Equal(CallbackReplyAction.End, session.OnReply(200, wantsAbort: true));
    }

    // -------------------------------------------------------------------------
    // Ending
    // -------------------------------------------------------------------------

    [Fact]
    public void Ended_IsFinal_NoMoreEventsOrFlushes()
    {
        var session = NewSession();
        session.OnReply(410, wantsAbort: false);

        session.Enqueue("diagnostic", null, T0);

        Assert.Equal(0, session.QueuedCount);
        Assert.Null(session.TakeDue(T0.AddSeconds(10), HeartbeatMs));
    }

    [Fact]
    public void MarkSolutionEnded_OnlyOnce()
    {
        var session = NewSession();
        Assert.True(session.MarkSolutionEnded());
        Assert.False(session.MarkSolutionEnded());
    }

    [Fact]
    public void MarkSolutionEnded_AfterTransportFailure_HasNoFinalFlush()
    {
        var session = NewSession();
        session.OnTransportFailure();
        Assert.False(session.MarkSolutionEnded());
    }

    [Fact]
    public void SolveDiagnostics_MarkAborted_BlocksWithGateError()
    {
        var diagnostics = new SolveDiagnostics();
        diagnostics.MarkAborted();

        Assert.True(diagnostics.Blocked);
        var message = Assert.Single(diagnostics.Messages);
        Assert.Equal("error", message.Level);
        Assert.True(message.IsGate);
    }
}
