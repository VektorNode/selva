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

    public const int Version = 5;

    /// <summary><see cref="int" />: the .rhp's <see cref="Version" />.</summary>
    public const string VersionKey = "version";

    /// <summary>
    ///     <c>Action&lt;string url, string sessionId, bool raise&gt;</c>: point the panel at a session
    ///     and open it. Without <c>raise</c>, a panel or pop-out already on screen keeps its place in
    ///     the z-order. UI thread only.
    /// </summary>
    public const string ShowKey = "show";

    /// <summary>
    ///     <c>Action&lt;string url, string sessionId&gt;</c>: point the panel at a session without
    ///     opening or raising it, for a switch the user made on the canvas. UI thread only.
    /// </summary>
    public const string FollowKey = "follow";

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
    ///     <c>Func&lt;string&gt;</c>: the <c>host</c> a session URL shown through this contract
    ///     declares. <see cref="PanelPageHost" /> in a Rhino panel, <see cref="AppPageHost" /> when
    ///     the Selva app shows the page in its own window.
    /// </summary>
    public const string PageHostKey = "pageHost";

    public const string PanelPageHost = "rhino";

    /// <summary>The page is outside Rhino: it has no viewport to preview in and no Rhino dialogs.</summary>
    public const string AppPageHost = "app";

    /// <summary>
    ///     The other direction. The .gha fills this AppDomain data slot when Grasshopper loads it,
    ///     with a dictionary holding <see cref="VersionKey" />, <see cref="OpenDefinitionKey" /> and
    ///     <see cref="CloseDefinitionKey" />.
    ///     A slot, because the .gha can't reach the .rhp without loading it, and either may load
    ///     first.
    /// </summary>
    public const string LauncherSlot = "Selva.Launcher";

    /// <summary>
    ///     <c>Func&lt;string path, string key, string refusal&gt;</c>: open a definition or a Selva
    ///     app file as a player session. <c>key</c> is what the user typed for a protected app
    ///     file, otherwise null. Returns null when it opened, otherwise why not, for the user.
    ///     Closes the current player definition first. UI thread only.
    /// </summary>
    public const string OpenDefinitionKey = "openDefinition";

    /// <summary><c>Action</c>: close the player definition, if one is open. UI thread only.</summary>
    public const string CloseDefinitionKey = "closeDefinition";

    /// <summary>
    ///     AppDomain data slot: an <c>Action</c> the .gha leaves for <see cref="RunActionCommand" />
    ///     to run. A viewport pick only finishes inside a running Rhino command, and only a
    ///     plug-in can register one.
    /// </summary>
    public const string CommandActionSlot = "Selva.CommandAction";

    /// <summary>The hidden command that runs whatever <see cref="CommandActionSlot" /> holds.</summary>
    public const string RunActionCommand = "SelvaRunAction";
}
