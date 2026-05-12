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
        if (IsSolving != isSolving)
        {
            var now = DateTime.UtcNow;
            var timeSinceLastChange = (now - _lastStateChangeTime).TotalMilliseconds;

            // Only debounce transitions TO solving (true), never FROM solving (false)
            // This ensures we never get stuck in a solving state
            if (isSolving && timeSinceLastChange < STATE_CHANGE_DEBOUNCE_MS)
            {
                // Too soon to start another solve - ignore rapid solve starts
                Debug.WriteLine(
                    $"[ComponentStateManager] Solve start debounced ({timeSinceLastChange:F0}ms since last change)");
                return false;
            }

            IsSolving = isSolving;
            _lastStateChangeTime = now;
            Debug.WriteLine($"[ComponentStateManager] Solving state changed to: {isSolving}");
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
