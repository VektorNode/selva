#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using Selva.GH.Utilities.Guards;

namespace Selva.GH.Features.UIBuilder.Services;

public class ComponentStateManager
{
    private const int STATE_CHANGE_DEBOUNCE_MS = 100;
    private bool _lastEnable;
    private DateTime _lastStateChangeTime = DateTime.MinValue;

    // The headless check is reached only through this lambda, never a direct HeadlessGuard reference in
    // a method body. That defers loading Rhino.dll (which HeadlessGuard pulls in) to *invocation* rather
    // than type load — so this otherwise Rhino-free class can be linked into the net8 test host, where
    // Rhino.dll isn't present, as long as the tests don't call the enable path.
    private readonly Func<bool> _isHeadless;

    public ComponentStateManager()
        : this(() => HeadlessGuard.IsHeadless)
    {
    }

    internal ComponentStateManager(Func<bool> isHeadless)
    {
        _isHeadless = isHeadless ?? (() => false);
    }

    // A SolutionStart was seen (possibly debounced) since the last SolutionEnd. The start-debounce
    // only suppresses redundant solving=true *indicator* broadcasts; it must NOT make the matching
    // end look like a no-op, or a real solve's outputs would never be collected/broadcast. This
    // flag lets SetSolving(false) report "a solve actually ran" even when its start was debounced —
    // the case that froze dynamic-value-list reconcile solves (they fire <100ms after the prior solve).
    private bool _solveStartedSinceLastEnd;

    // A solve was scheduled (via document.ScheduleSolution) but its SolutionStart hasn't fired yet.
    // ScheduleSolution defers ~10ms, during which IsSolving is still false — so a second value update
    // arriving in that gap would otherwise schedule a *second* solve. This flag, set synchronously the
    // moment we schedule, makes IsBusy true across the whole schedule→start→end cycle so the second
    // update coalesces (see _pendingValues) instead of double-scheduling. Cleared when a real solve ends.
    private bool _solveScheduled;

    // Latest-wins coalesce buffer. When a value update arrives while IsBusy, we merge it here instead
    // of dropping it (the old behavior silently lost the final slider value when the update landed in
    // the ~1 RTT window before the client's solving mirror caught up). Drained on a fresh UI tick after
    // the in-flight solve ends — never inline in the SolutionEnd handler, which is reentrant. Null when
    // empty; the `?` annotation is a no-op in the plugin (nullable disabled) but silences the warning in
    // the nullable-enabled test build that links this file.
    private Dictionary<string, object>? _pendingValues;

    public bool IsSolving { get; private set; }

    /// <summary>
    ///     True while a solve is running OR scheduled-but-not-yet-started. Value updates arriving while
    ///     busy must coalesce into the pending buffer rather than scheduling a competing solve.
    /// </summary>
    public bool IsBusy => IsSolving || _solveScheduled;

    public bool IsHeadlessMode => _isHeadless();

    public StateTransition ProcessEnableInput(bool enable)
    {
        var enableRising = enable && !_lastEnable;
        var enableFalling = !enable && _lastEnable;

        _lastEnable = enable;

        return new StateTransition
        {
            EnableRising = enableRising,
            EnableFalling = enableFalling,
            IsEnabled = enable,
            IsHeadless = IsHeadlessMode
        };
    }

    /// <summary>Returns true if state actually changed and should be broadcast.</summary>
    public bool SetSolving(bool isSolving)
    {
        // A solve ended: report whether a real solve ran since the last end so callers can collect
        // outputs. True when we were tracking IsSolving OR a start was debounced in between — the
        // latter keeps a fast follow-up solve (e.g. dynamic-list reconcile) from being silently
        // dropped. Resets the per-cycle flag.
        if (!isSolving)
        {
            var solved = IsSolving || _solveStartedSinceLastEnd;
            IsSolving = false;
            _solveStartedSinceLastEnd = false;
            // The scheduled solve has now run (or this end belongs to it). Clear the gate so the next
            // value update can schedule again rather than coalescing forever.
            _solveScheduled = false;
            if (solved)
            {
                _lastStateChangeTime = DateTime.UtcNow;
            }

            Debug.WriteLine($"[ComponentStateManager] Solve ended (actuallySolving={solved})");
            return solved;
        }

        // A solve started. Record it for the matching end even if we debounce the indicator below.
        _solveStartedSinceLastEnd = true;

        if (!IsSolving)
        {
            var now = DateTime.UtcNow;
            var timeSinceLastChange = (now - _lastStateChangeTime).TotalMilliseconds;

            // Debounce only the solving=true indicator broadcast — rapid back-to-back solve starts
            // shouldn't spam the UI. The end still collects outputs via _solveStartedSinceLastEnd.
            if (timeSinceLastChange < STATE_CHANGE_DEBOUNCE_MS)
            {
                Debug.WriteLine(
                    $"[ComponentStateManager] Solve start debounced ({timeSinceLastChange:F0}ms since last change)");
                return false;
            }

            IsSolving = true;
            _lastStateChangeTime = now;
            Debug.WriteLine("[ComponentStateManager] Solving state changed to: True");
            return true;
        }

        return false;
    }

    /// <summary>
    ///     Record that a solve has been scheduled (its SolutionStart hasn't fired yet). Call this
    ///     synchronously right after document.ScheduleSolution so the schedule→start gap is covered
    ///     by <see cref="IsBusy" />. Cleared automatically when the matching solve ends.
    /// </summary>
    public void MarkSolveScheduled()
    {
        _solveScheduled = true;
    }

    /// <summary>
    ///     Merge a value update into the latest-wins coalesce buffer. Called when an update arrives
    ///     while <see cref="IsBusy" /> instead of dropping it. Later keys overwrite earlier ones, so a
    ///     fast drag collapses to a single trailing apply.
    /// </summary>
    public void MergePendingValues(IReadOnlyDictionary<string, object>? values)
    {
        if (values == null || values.Count == 0)
        {
            return;
        }

        _pendingValues ??= new Dictionary<string, object>();
        foreach (var kvp in values)
        {
            _pendingValues[kvp.Key] = kvp.Value;
        }
    }

    public bool HasPendingValues => _pendingValues != null && _pendingValues.Count > 0;

    /// <summary>
    ///     Take and clear the coalesce buffer. The caller applies the returned values; clearing here
    ///     (before the apply schedules its solve) means a value changed *during* that solve is captured
    ///     for the next cycle rather than lost or double-applied. Returns null when nothing is pending.
    /// </summary>
    public Dictionary<string, object>? TakePendingValues()
    {
        var pending = _pendingValues;
        _pendingValues = null;
        return pending;
    }

    public void Reset()
    {
        IsSolving = false;
        _lastEnable = false;
        _lastStateChangeTime = DateTime.MinValue;
        _solveScheduled = false;
        _solveStartedSinceLastEnd = false;
        _pendingValues = null;
    }
}

public class StateTransition
{
    public bool EnableRising { get; set; }
    public bool EnableFalling { get; set; }
    public bool IsEnabled { get; set; }
    public bool IsHeadless { get; set; }

    public bool ShouldStartCommunication => IsEnabled && !IsHeadless;
    public bool ShouldStopCommunication => !IsEnabled;
}
