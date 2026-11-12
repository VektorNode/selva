using System;
using System.IO;

namespace Selva.RhinoPanel;

/// <summary>
///     Whether this is a development install: <c>selva.dev.json</c> sits beside the plug-in
///     (<c>pnpm install:plugin:dev</c> puts it there) or <c>SELVA_DEV=1</c>. A released install has
///     neither. Compiled into Selva.gha and Selva.Panel.rhp, which install into one folder.
/// </summary>
internal static class DevInstall
{
    public const string MarkerFile = "selva.dev.json";

    public static bool Detected { get; } = Detect();

    /// <summary>
    ///     The one switch for the Selva app: Export as app, opening an app file, and the
    ///     <c>SelvaApp</c> and <c>SelvaAppHost</c> commands. Development installs only. A release
    ///     that turns it on must also ship the app: <c>--with-app</c> in
    ///     <c>scripts/plugin/build-production.js</c>.
    /// </summary>
    public static bool HasSelvaApp => Detected;

    private static bool Detect()
    {
        if (Environment.GetEnvironmentVariable("SELVA_DEV") == "1")
        {
            return true;
        }

        try
        {
            // Empty when the host loaded the assembly from bytes; the env var still works then.
            var location = typeof(DevInstall).Assembly.Location;
            return !string.IsNullOrEmpty(location) &&
                   File.Exists(Path.Combine(Path.GetDirectoryName(location)!, MarkerFile));
        }
        catch
        {
            return false;
        }
    }
}
