using Rhino;

namespace Selva.GH.Utilities.Guards;

/// <summary>
///     Detects whether the plugin is running under Rhino.Compute (or any other
///     headless Rhino host). Used to skip side effects (file writes, history
///     logging, server lifecycles) that only make sense in an interactive Rhino
///     session.
/// </summary>
public static class HeadlessGuard
{
    /// <summary>
    ///     True when there is no interactive Rhino document, e.g. under
    ///     Rhino.Compute or any other headless host. Compute should be treated
    ///     as read-only — no migration backups, no schema history writes.
    /// </summary>
    public static bool IsHeadless =>
        RhinoApp.IsRunningHeadless
        || RhinoDoc.ActiveDoc == null
        || RhinoDoc.ActiveDoc.IsHeadless;
}
