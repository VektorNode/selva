using System;
using System.IO;
using System.Threading.Tasks;

namespace Selva.GH.Utilities.Helpers;

/// <summary>
///     Developer diagnostics: a JSON-lines log of everything <see cref="Logger" /> sees plus the bridge's
///     message traffic, and a file per live session that lets tools outside Rhino connect without a
///     copied URL. On when <c>selva.dev.json</c> sits beside Selva.gha (<c>pnpm install:plugin:dev</c>
///     puts it there) or <c>SELVA_DEV=1</c>. A released install has neither, so it never writes.
/// </summary>
public static class DevMode
{
    public const string MarkerFile = "selva.dev.json";

    public static bool Enabled { get; } = Detect();

    /// <summary>
    ///     <c>%LOCALAPPDATA%\Selva\dev</c> on Windows, <c>~/Library/Application Support/Selva/dev</c>
    ///     on macOS. <c>scripts/plugin/dev-session.mjs</c> reads the same place.
    /// </summary>
    public static string Directory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Selva", "dev");

    private static bool Detect()
    {
        if (Environment.GetEnvironmentVariable("SELVA_DEV") == "1")
        {
            return true;
        }

        try
        {
            // Empty when Grasshopper loaded the assembly from bytes; the env var still works then.
            var location = typeof(DevMode).Assembly.Location;
            return !string.IsNullOrEmpty(location) &&
                   File.Exists(Path.Combine(Path.GetDirectoryName(location)!, MarkerFile));
        }
        catch
        {
            return false;
        }
    }

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
