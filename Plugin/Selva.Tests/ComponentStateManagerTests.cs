using System.Collections.Generic;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

/// <summary>
///     Tests for ComponentStateManager — the solve-lifecycle state machine that guards against the two
///     race conditions in the Grasshopper ↔ web bridge:
///     <list type="bullet">
///         <item>
///             <b>Double solve.</b> document.ScheduleSolution defers ~10ms before SolutionStart fires.
///             A value update arriving in that gap must coalesce, not schedule a second solve. The
///             <see cref="ComponentStateManager.MarkSolveScheduled" /> flag makes <see
///             cref="ComponentStateManager.IsBusy" /> true across the whole schedule→start→end cycle.
///         </item>
///         <item>
///             <b>Lost final value.</b> Updates arriving while busy used to be dropped server-side,
///             silently losing the final slider value. They now merge into a latest-wins buffer drained
///             after the solve ends.
///         </item>
///     </list>
///     Pure POCO under test — no Rhino, no document, no sockets. The headless seam is injected as a
///     constant so the enable path never touches Rhino.
/// </summary>
public class ComponentStateManagerTests
{
    private static ComponentStateManager NewManager() => new ComponentStateManager(() => false);

    private static Dictionary<string, object> Values(params (string Key, object Value)[] pairs)
    {
        var dict = new Dictionary<string, object>();
        foreach (var (key, value) in pairs)
        {
            dict[key] = value;
        }

        return dict;
    }

    // -------------------------------------------------------------------------
    // IsBusy / scheduled gate (double-solve guard)
    // -------------------------------------------------------------------------

    [Fact]
    public void FreshManager_IsNotBusy()
    {
        Assert.False(NewManager().IsBusy);
    }

    [Fact]
    public void MarkSolveScheduled_MakesBusy_BeforeSolutionStart()
    {
        var sm = NewManager();

        // The schedule→start gap: a solve is scheduled but SolutionStart hasn't fired, so IsSolving is
        // still false. IsBusy must already be true so a second update coalesces instead of double-scheduling.
        sm.MarkSolveScheduled();

        Assert.True(sm.IsBusy);
        Assert.False(sm.IsSolving);
    }

    [Fact]
    public void Busy_StaysTrue_AcrossScheduleThenStart()
    {
        var sm = NewManager();
        sm.MarkSolveScheduled();
        sm.SetSolving(true);

        Assert.True(sm.IsBusy);
        Assert.True(sm.IsSolving);
    }

    [Fact]
    public void SolutionEnd_ClearsScheduledGate()
    {
        var sm = NewManager();
        sm.MarkSolveScheduled();
        sm.SetSolving(true);
        sm.SetSolving(false);

        Assert.False(sm.IsBusy);
    }

    [Fact]
    public void SolutionEnd_ClearsScheduledGate_EvenIfStartWasDebounced()
    {
        var sm = NewManager();

        // First solve completes so the next start lands inside the 100ms debounce window.
        sm.SetSolving(true);
        sm.SetSolving(false);

        // Second solve: scheduled + started, but the start is debounced (returns false) — the gate must
        // still clear on end, otherwise IsBusy would latch true forever and every later update would coalesce.
        sm.MarkSolveScheduled();
        var startBroadcast = sm.SetSolving(true);
        Assert.False(startBroadcast); // debounced
        Assert.True(sm.IsBusy);

        var actuallySolved = sm.SetSolving(false);
        Assert.True(actuallySolved); // a real solve ran despite the debounced start
        Assert.False(sm.IsBusy);
    }

    // -------------------------------------------------------------------------
    // Pending coalesce buffer (lost-value guard)
    // -------------------------------------------------------------------------

    [Fact]
    public void NoPendingValues_OnFreshManager()
    {
        var sm = NewManager();

        Assert.False(sm.HasPendingValues);
        Assert.Null(sm.TakePendingValues());
    }

    [Fact]
    public void MergePendingValues_BuffersUpdate()
    {
        var sm = NewManager();

        sm.MergePendingValues(Values(("a", 1)));

        Assert.True(sm.HasPendingValues);
    }

    [Fact]
    public void MergePendingValues_LatestWins_PerKey()
    {
        var sm = NewManager();

        // A fast slider drag: same key updated repeatedly while busy. Only the final value should survive.
        sm.MergePendingValues(Values(("slider", 1)));
        sm.MergePendingValues(Values(("slider", 2)));
        sm.MergePendingValues(Values(("slider", 3)));

        var pending = sm.TakePendingValues();

        Assert.NotNull(pending);
        Assert.Single(pending);
        Assert.Equal(3, pending["slider"]);
    }

    [Fact]
    public void MergePendingValues_UnionsDistinctKeys()
    {
        var sm = NewManager();

        sm.MergePendingValues(Values(("a", 1)));
        sm.MergePendingValues(Values(("b", 2)));

        var pending = sm.TakePendingValues();

        Assert.NotNull(pending);
        Assert.Equal(2, pending.Count);
        Assert.Equal(1, pending["a"]);
        Assert.Equal(2, pending["b"]);
    }

    [Fact]
    public void TakePendingValues_ClearsBuffer()
    {
        var sm = NewManager();
        sm.MergePendingValues(Values(("a", 1)));

        var first = sm.TakePendingValues();
        Assert.NotNull(first);

        // Cleared after take: a value changed *during* the drain solve is captured for the next cycle,
        // not double-applied. A second take with no new merge returns nothing.
        Assert.False(sm.HasPendingValues);
        Assert.Null(sm.TakePendingValues());
    }

    [Fact]
    public void MergePendingValues_AfterTake_StartsFreshBuffer()
    {
        var sm = NewManager();
        sm.MergePendingValues(Values(("a", 1)));
        sm.TakePendingValues();

        // A change arriving after the drain took the buffer begins a new pending cycle.
        sm.MergePendingValues(Values(("b", 2)));

        var pending = sm.TakePendingValues();
        Assert.NotNull(pending);
        Assert.Single(pending);
        Assert.Equal(2, pending["b"]);
    }

    [Fact]
    public void MergePendingValues_IgnoresNullAndEmpty()
    {
        var sm = NewManager();

        sm.MergePendingValues(null);
        sm.MergePendingValues(new Dictionary<string, object>());

        Assert.False(sm.HasPendingValues);
    }

    // -------------------------------------------------------------------------
    // Reset clears all coalesce/scheduled state
    // -------------------------------------------------------------------------

    [Fact]
    public void Reset_ClearsBusyAndPending()
    {
        var sm = NewManager();
        sm.MarkSolveScheduled();
        sm.SetSolving(true);
        sm.MergePendingValues(Values(("a", 1)));

        sm.Reset();

        Assert.False(sm.IsBusy);
        Assert.False(sm.IsSolving);
        Assert.False(sm.HasPendingValues);
    }
}
