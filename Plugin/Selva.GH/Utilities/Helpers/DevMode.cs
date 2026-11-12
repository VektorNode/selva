using System;
using System.IO;
using System.Threading.Tasks;
using Selva.RhinoPanel;

namespace Selva.GH.Utilities.Helpers;

/// <summary>
///     Developer diagnostics: a JSON-lines log of everything <see cref="Logger" /> sees plus the bridge's
///     message traffic, and a file per live session that lets tools outside Rhino connect without a
///     copied URL. On in a development install (<see cref="DevInstall" />). A released install
///     never writes.
/// </summary>
public static class DevMode
{
    public static bool Enabled => DevInstall.Detected;

    /// <summary>
    ///     <c>%LOCALAPPDATA%\Selva\dev</c> on Windows, <c>~/Library/Application Support/Selva/dev</c>
    ///     on macOS. <c>scripts/plugin/dev-session.mjs</c> reads the same place.
    /// </summary>
    public static string Directory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Selva", "dev");

    /// <summary>
    ///     Once, at plugin load. Records what loaded and catches what would otherwise vanish. Takes the
    ///     Rhino version rather than reading it, so the tests can link this file without RhinoCommon.
    /// </summary>
    public static void Start(string rhinoVersion)
    {
        if (!Enabled)
        {
            return;
        }

        var assembly = typeof(DevMode).Assembly;
        Logger.Trace(
            $"Selva {assembly.GetName().Version} loaded from {assembly.Location} " +
            $"(Rhino {rhinoVersion}, {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription})");

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Logger.Error("Unhandled exception", args.ExceptionObject as Exception);
        // A faulted fire-and-forget task (`_ = SendAsync(...)`) otherwise disappears without a trace.
        TaskScheduler.UnobservedTaskException += (_, args) =>
            Logger.Error("Unobserved task exception", args.Exception);
    }
}
