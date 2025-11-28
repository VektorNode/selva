using Rhino;

namespace Selva.Features.UIBuilder.Services;

/// <summary>
///   Manages component lifecycle state
/// </summary>
public class ComponentStateManager
{
  private bool _lastEnable;

  public bool IsSolving { get; private set; }

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
  /// </summary>
  public void SetSolving(bool isSolving)
  {
    IsSolving = isSolving;
  }

  /// <summary>
  ///   Reset all state (called when component is disabled or cleaned up)
  /// </summary>
  public void Reset()
  {
    IsSolving = false;
    _lastEnable = false;
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
