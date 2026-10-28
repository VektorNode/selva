namespace Selva.RhinoPanel;

/// <summary>
///     What <c>Selva.Panel.rhp</c>'s <c>GetPlugInObject()</c> returns to <c>Selva.gha</c>, and
///     what the .gha leaves in <see cref="LauncherSlot" /> for the .rhp: dictionaries of BCL values
///     under the keys below. This file is compiled into both assemblies.
///     Nothing but BCL types may cross: the .gha internalizes its dependencies and the two plug-ins
///     can load in different contexts, so a shared interface would not be the same type on both
///     sides.
///
///     Bump <see cref="Version" /> on any change to a key or a delegate signature. The .gha opens the
///     browser instead when the versions differ, and the .rhp's launcher says Selva needs reinstalling.
/// </summary>
internal static class PanelContract
{
    /// <summary>The .rhp's plug-in id (its assembly Guid).</summary>
    public const string PlugInId = "7649CEEB-F498-4E01-B967-7902C427FDD7";

    public const int Version = 2;

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

    /// <summary>
    ///     <c>Action&lt;string message&gt;</c>: a player session failed after the launcher handed
    ///     the file over, where its runtime messages would land on a hidden canvas. The panel
    ///     shows the message in place of its progress. UI thread only.
    /// </summary>
    public const string NotifyKey = "notify";

    /// <summary>
    ///     The other direction. The .gha fills this AppDomain data slot when Grasshopper loads it,
    ///     with a dictionary holding <see cref="VersionKey" /> and <see cref="OpenDefinitionKey" />.
    ///     A slot, because the .gha can't reach the .rhp without loading it, and either may load
    ///     first.
    /// </summary>
    public const string LauncherSlot = "Selva.Launcher";

    /// <summary>
    ///     <c>Func&lt;string path, string refusal&gt;</c>: open a definition as a player session.
    ///     Returns null when it opened, otherwise why not, for the user. Closes the current player
    ///     definition first. UI thread only.
    /// </summary>
    public const string OpenDefinitionKey = "openDefinition";

    /// <summary>
    ///     AppDomain data slot: an <c>Action</c> the .gha leaves for <see cref="RunActionCommand" />
    ///     to run. A viewport pick only finishes inside a running Rhino command, and only a
    ///     plug-in can register one.
    /// </summary>
    public const string CommandActionSlot = "Selva.CommandAction";

    /// <summary>The hidden command that runs whatever <see cref="CommandActionSlot" /> holds.</summary>
    public const string RunActionCommand = "SelvaRunAction";
}
