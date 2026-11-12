namespace Selva.AppHost;

// ============================================================================
// Selva app <-> Rhino
// ============================================================================
//
// The Selva app starts Rhino with its window hidden and has it run `SelvaAppHost <address>`.
// Selva.Panel.rhp connects there, and from then on the two talk in UTF-8 lines, one flat JSON
// object of strings per line, each with a "type". This file is compiled into both C# sides; the
// Mac app (Selva.App.Mac) keeps its own copy of the names.
//
//   <address>  Windows: the name of a named pipe the app serves.
//              macOS:   the path of a Unix socket the app listens on. No spaces: it is one
//                       token on Rhino's command line.
//
//   Rhino -> app
//     ready    { rhino }             connected; `rhino` is its version
//     step     { step }              an open reached "LoadingGrasshopper", "Solving" or "StartingUI"
//     show     { url, sessionId }    the session's page; the app navigates its window to it
//     clear    { }                   the session closed and nothing is opening
//     error    { message }           an open failed, or a session failed after it opened
//
//   app -> Rhino
//     open     { path, key? }        open a definition or an app file; `key` for a protected one
//     close    { }                   close the open definition
//     quit     { }                   close it and exit Rhino
//
// Rhino also exits when the connection breaks: the app is gone and nothing else can reach this Rhino.
internal static class AppHostProtocol
{
    /// <summary>The Rhino command that takes the address.</summary>
    public const string Command = "SelvaAppHost";

    public const string TypeField = "type";

    public const string Ready = "ready";
    public const string Step = "step";
    public const string Show = "show";
    public const string Clear = "clear";
    public const string Error = "error";

    public const string Open = "open";
    public const string Close = "close";
    public const string Quit = "quit";

    public const string RhinoField = "rhino";
    public const string StepField = "step";
    public const string UrlField = "url";
    public const string SessionIdField = "sessionId";
    public const string MessageField = "message";
    public const string PathField = "path";
    public const string KeyField = "key";
}
