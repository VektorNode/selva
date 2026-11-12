#nullable enable
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using Microsoft.Win32;
using Selva.App;

namespace Selva.Setup;

/// <summary>
///     Installs and removes Selva for the current user: the plug-in into each Rhino's package
///     folder, the app's file type and Start menu entry, and an entry under Windows' installed
///     apps. Nothing here needs elevation.
/// </summary>
internal static class Installation
{
    private const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Selva";
    private const string SetupExeName = "SelvaSetup.exe";

    // Hosts that load Selva.gha and so lock its folder.
    private static readonly string[] LockingProcesses = { "Rhino", "compute.geometry", "rhino.compute" };

    private static readonly TimeSpan RegisterTimeout = TimeSpan.FromSeconds(20);

    /// <summary>Where the uninstaller lives: this exe, copied out of wherever it was downloaded to.</summary>
    private static string ProgramFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Selva");

    private static string OwnPath => Assembly.GetExecutingAssembly().Location;

    /// <summary>The Selva version this installer carries; null for a build without packages.</summary>
    public static string? PayloadVersion()
    {
        foreach (var version in RhinoInstalls.Versions)
        {
            using var yak = OpenPayload(version);
            if (yak != null)
            {
                return PackagePayload.ReadVersion(yak);
            }
        }

        return null;
    }

    /// <summary>The Rhinos on this machine that this installer has a package for.</summary>
    public static List<RhinoInstall> Targets()
    {
        return RhinoInstalls.Find().Where(rhino => HasPayload(rhino.Version)).ToList();
    }

    public static bool RhinoIsRunning()
    {
        return LockingProcesses.Any(name =>
        {
            var processes = Process.GetProcessesByName(name);
            foreach (var process in processes)
            {
                process.Dispose();
            }

            return processes.Length > 0;
        });
    }

    /// <exception cref="IOException">A file is in use: Rhino started in the meantime.</exception>
    public static void Install(string version, IReadOnlyList<RhinoInstall> targets)
    {
        foreach (var rhino in targets)
        {
            using var yak = OpenPayload(rhino.Version)!;
            PackagePayload.Install(yak, rhino.SelvaFolder, version);
        }

        var uninstaller = KeepUninstaller();
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", "Selva");
            key.SetValue("DisplayVersion", version);
            key.SetValue("Publisher", "VektorNode");
            key.SetValue("DisplayIcon", uninstaller);
            key.SetValue("InstallLocation", ProgramFolder);
            key.SetValue("UninstallString", $"\"{uninstaller}\" /uninstall");
            key.SetValue("QuietUninstallString", $"\"{uninstaller}\" /uninstall /quiet");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }

        // The app owns its registration: the file type, Open with and the Start menu entry.
        RunApp("--register");
    }

    public static void Uninstall()
    {
        RunApp("--unregister");
        foreach (var version in RhinoInstalls.Versions)
        {
            PackagePayload.DeleteFolder(RhinoInstalls.SelvaFolder(version));
        }

        Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
        RemoveProgramFolderAfterExit();
    }

    /// <summary>The installed app, from the newest Rhino that has it; null when it isn't installed.</summary>
    public static string? AppExe()
    {
        foreach (var version in RhinoInstalls.Versions)
        {
            var folder = RhinoInstalls.SelvaFolder(version);
            var pointer = Path.Combine(folder, "manifest.txt");
            if (!File.Exists(pointer))
            {
                continue;
            }

            var exe = Path.Combine(folder, File.ReadAllText(pointer).Trim(), "app", "SelvaApp.exe");
            if (File.Exists(exe))
            {
                return exe;
            }
        }

        return null;
    }

    private static void RunApp(string argument)
    {
        var exe = AppExe();
        if (exe == null)
        {
            return;
        }

        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            Arguments = argument,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        process?.WaitForExit((int)RegisterTimeout.TotalMilliseconds);
    }

    private static string KeepUninstaller()
    {
        var kept = Path.Combine(ProgramFolder, SetupExeName);
        if (!string.Equals(Path.GetFullPath(OwnPath), Path.GetFullPath(kept), StringComparison.OrdinalIgnoreCase))
        {
            Directory.CreateDirectory(ProgramFolder);
            File.Copy(OwnPath, kept, true);
        }

        return kept;
    }

    /// <summary>A running exe can't delete itself, so a shell does it once this process is gone.</summary>
    private static void RemoveProgramFolderAfterExit()
    {
        if (!Directory.Exists(ProgramFolder))
        {
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"{ProgramFolder}\"",
            UseShellExecute = false,
            CreateNoWindow = true
        })?.Dispose();
    }

    private static bool HasPayload(string rhinoVersion)
    {
        using var yak = OpenPayload(rhinoVersion);
        return yak != null;
    }

    private static Stream? OpenPayload(string rhinoVersion)
    {
        return Assembly.GetExecutingAssembly().GetManifestResourceStream($"Selva.Setup.payload.{rhinoVersion}.yak");
    }
}
