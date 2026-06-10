using System;
using System.Diagnostics;
using Selva.GH.Utilities.Guards;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Manages component lifecycle state with robust solving state tracking
/// </summary>
public class ComponentStateManager
{
    private const int STATE_CHANGE_DEBOUNCE_MS = 100;
    private bool _lastEnable;
    private DateTime _lastStateChangeTime = DateTime.MinValue;

    // A SolutionStart was seen (possibly debounced) since the last SolutionEnd. The start-debounce
    // only suppresses redundant solving=true *indicator* broadcasts; it must NOT make the matching
    // end look like a no-op, or a real solve's outputs would never be collected/broadcast. This
    // flag lets SetSolving(false) report "a solve actually ran" even when its start was debounced —
    // the case that froze dynamic-value-list reconcile solves (they fire <100ms after the prior solve).
    private bool _solveStartedSinceLastEnd;

    public bool IsSolving { get; private set; }

    /// <summary>
    ///     Check if running in headless mode (no Rhino UI)
    /// </summary>
    public bool IsHeadlessMode => HeadlessGuard.IsHeadless;

    /// <summary>
    ///     Process enable input and detect state transitions
    /// </summary>
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

    /// <summary>
    ///     Set solving state (called during solution start/end)
    ///     Returns true if state actually changed and should be broadcast
    /// </summary>
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
    ///     Reset all state (called when component is disabled or cleaned up)
    /// </summary>
    public void Reset()
    {
        IsSolving = false;
        _lastEnable = false;
        _lastStateChangeTime = DateTime.MinValue;
    }
}

/// <summary>
///     Information about state transitions after processing enable input
/// </summary>
public class StateTransition
{
    public bool EnableRising { get; set; }
    public bool EnableFalling { get; set; }
    public bool IsEnabled { get; set; }
    public bool IsHeadless { get; set; }

    public bool ShouldStartCommunication => IsEnabled && !IsHeadless;
    public bool ShouldStopCommunication => !IsEnabled;
}
