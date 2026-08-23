using System.Collections.Generic;
using Selva.GH.Features.UIBuilder.Services;

namespace Selva.Tests;

/// <summary>
///     Tests for ComponentStateManager: the solve-lifecycle state machine guarding against double-solve
///     (a value update landing in the ScheduleSolution→SolutionStart gap) and lost updates (one arriving
///     while busy, which must coalesce instead of being dropped).
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

        // Fast slider drag: same key updated repeatedly while busy.
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

        Assert.False(sm.HasPendingValues);
        Assert.Null(sm.TakePendingValues());
    }

    [Fact]
    public void MergePendingValues_AfterTake_StartsFreshBuffer()
    {
        var sm = NewManager();
        sm.MergePendingValues(Values(("a", 1)));
        sm.TakePendingValues();
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
