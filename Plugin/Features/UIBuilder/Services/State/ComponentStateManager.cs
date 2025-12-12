using System;
using System.Diagnostics;
using Rhino;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Manages component lifecycle state with robust solving state tracking
/// </summary>
public class ComponentStateManager
{
  private bool _lastEnable;
  private bool _isSolving;
  private DateTime _lastStateChangeTime = DateTime.MinValue;
  private const int STATE_CHANGE_DEBOUNCE_MS = 100; // Prevent duplicate broadcasts within 100ms

  public bool IsSolving => _isSolving;

  /// <summary>
  ///   Check if running in headless mode (no Rhino UI)
  /// </summary>
  public bool IsHeadlessMode =>
    RhinoDoc.ActiveDoc == null || RhinoApp.IsRunningHeadless || RhinoDoc.ActiveDoc.IsHeadless;

  /// <summary>
  ///   Process enable input and detect state transitions
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
  ///   Set solving state (called during solution start/end)
  ///   Returns true if state actually changed and should be broadcast
  /// </summary>
  public bool SetSolving(bool isSolving)
  {
    if (_isSolving != isSolving)
    {
      // Check if we're debouncing - ignore rapid state changes
      var now = DateTime.UtcNow;
      var timeSinceLastChange = (now - _lastStateChangeTime).TotalMilliseconds;

      if (timeSinceLastChange < STATE_CHANGE_DEBOUNCE_MS)
      {
        // Too soon - ignore this state change to prevent rapid toggling
        Debug.WriteLine(
          $"[ComponentStateManager] State change debounced (attempted {isSolving}, {timeSinceLastChange:F0}ms since last change)");
        return false;
      }

      _isSolving = isSolving;
      _lastStateChangeTime = now;
      Debug.WriteLine($"[ComponentStateManager] Solving state changed to: {isSolving}");
      return true;
    }

    return false;
  }


  /// <summary>
  ///   Reset all state (called when component is disabled or cleaned up)
  /// </summary>
  public void Reset()
  {
    _isSolving = false;
    _lastEnable = false;
    _lastStateChangeTime = DateTime.MinValue;
  }
}

/// <summary>
///   Information about state transitions after processing enable input
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
