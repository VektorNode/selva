namespace Selva.RhinoPanel;

/// <summary>
///     What <c>Selva.Panel.rhp</c>'s <c>GetPlugInObject()</c> returns to <c>Selva.gha</c>: a
///     dictionary of BCL values under the keys below. This file is compiled into both assemblies.
///     Nothing but BCL types may cross: the .gha internalizes its dependencies and the two plug-ins
///     can load in different contexts, so a shared interface would not be the same type on both
///     sides.
///
///     Bump <see cref="Version" /> on any change to a key or a delegate signature. The .gha opens the
///     browser instead when the versions differ.
/// </summary>
internal static class PanelContract
{
    /// <summary>The .rhp's plug-in id (its assembly Guid).</summary>
    public const string PlugInId = "7649CEEB-F498-4E01-B967-7902C427FDD7";

    public const int Version = 1;

    /// <summary><see cref="int" />: the .rhp's <see cref="Version" />.</summary>
    public const string VersionKey = "version";

    /// <summary>
    ///     <c>Action&lt;string url, string sessionId&gt;</c>: point the panel at a session and open it.
    ///     UI thread only.
    /// </summary>
    public const string ShowKey = "show";

    /// <summary>
    ///     <c>Action&lt;string sessionId&gt;</c>: empty the panel, only if it still shows that
    ///     session. UI thread only.
    /// </summary>
    public const string ClearKey = "clear";
}
