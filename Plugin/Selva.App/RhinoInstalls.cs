using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Win32;

namespace Selva.App;

/// <summary>One Rhino on this machine, and where Selva goes for it.</summary>
internal sealed class RhinoInstall
{
    public RhinoInstall(string version, string exePath, string selvaFolder)
    {
        Version = version;
        ExePath = exePath;
        SelvaFolder = selvaFolder;
    }

    /// <summary>The package folder's name for this Rhino: "8.0" or "9.0".</summary>
    public string Version { get; }

    public string ExePath { get; }

    /// <summary>
    ///     Selva's folder among this Rhino's packages. It holds one folder per installed version
    ///     and a <c>manifest.txt</c> naming the one Rhino loads, as the package manager leaves it.
    /// </summary>
    public string SelvaFolder { get; }

    public bool HasSelva => Directory.Exists(SelvaFolder);

    public string DisplayName => "Rhino " + Version.Split('.')[0];
}

/// <summary>Finds the Rhinos Selva supports. Compiled into the app and its installer.</summary>
internal static class RhinoInstalls
{
    // Newest first.
    public static readonly string[] Versions = { "9.0", "8.0" };

    public static string PackagesRoot => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "McNeel", "Rhinoceros", "packages");

    public static string SelvaFolder(string version)
    {
        return Path.Combine(PackagesRoot, version, "Selva");
    }

    public static List<RhinoInstall> Find()
    {
        var found = new List<RhinoInstall>();
        foreach (var version in Versions)
        {
            using var key = Registry.LocalMachine.OpenSubKey($@"SOFTWARE\McNeel\Rhinoceros\{version}\Install");
            if (key?.GetValue("ExePath") is string exePath && File.Exists(exePath))
            {
                found.Add(new RhinoInstall(version, exePath, SelvaFolder(version)));
            }
        }

        return found;
    }
}
