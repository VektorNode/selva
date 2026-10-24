using System;

namespace Selva.RhinoPanel;

internal enum NavigationDecision
{
    Allow,
    OpenInBrowser,

    /// <summary>A <c>selva-panel://&lt;command&gt;</c> link: the page asking its host to act.</summary>
    HostCommand,
    Block
}

/// <summary>
///     Which navigations the UI's WebView may perform. It only ever shows the session page:
///     anything on another origin leaves Rhino for the system browser, under the same rule the
///     bridge uses for its own links (https anywhere, http on loopback only).
/// </summary>
internal static class NavigationPolicy
{
    /// <summary>
    ///     The page reaches its host by navigating here, which works on every Eto build; Eto's
    ///     message channel only came with Rhino 8.18. The URL's host names the command.
    /// </summary>
    public const string CommandScheme = "selva-panel";

    /// <summary>Moves the UI from the docked panel into its own window, or back.</summary>
    public const string ToggleWindowCommand = "toggle-window";

    /// <summary>Shows Rhino's Open dialog and opens the pick as a player session, closing the current one.</summary>
    public const string OpenCommand = "open";

    public static NavigationDecision Decide(Uri target, Uri requested)
    {
        if (requested.Scheme == CommandScheme)
        {
            return NavigationDecision.HostCommand;
        }

        // The host blanks the WebView with about:blank when its session is cleared.
        if (requested.AbsoluteUri == "about:blank" || IsSameOrigin(target, requested))
        {
            return NavigationDecision.Allow;
        }

        if (requested.Scheme == Uri.UriSchemeHttps ||
            (requested.Scheme == Uri.UriSchemeHttp && requested.IsLoopback))
        {
            return NavigationDecision.OpenInBrowser;
        }

        // blob: and data: included. A download link to a blob navigates the whole WKWebView to
        // the file's contents and drops the session.
        return NavigationDecision.Block;
    }

    private static bool IsSameOrigin(Uri a, Uri b)
    {
        return a.Scheme == b.Scheme &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) &&
               a.Port == b.Port;
    }
}
