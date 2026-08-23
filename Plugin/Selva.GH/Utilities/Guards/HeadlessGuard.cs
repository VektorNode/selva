using Rhino;

namespace Selva.GH.Utilities.Guards;

/// <summary>
///     True under Rhino.Compute or any other headless Rhino host. Callers use this to skip
///     side effects that only make sense in an interactive session — file writes, history
///     logging, server lifecycles. Compute is treated as read-only: no migration backups,
///     no schema history writes.
/// </summary>
public static class HeadlessGuard
{
    public static bool IsHeadless =>
        RhinoApp.IsRunningHeadless
        || RhinoDoc.ActiveDoc == null
        || RhinoDoc.ActiveDoc.IsHeadless;
}
