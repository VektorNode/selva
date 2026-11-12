using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Selva.AppFormat;

namespace Selva.App;

/// <summary>
///     Makes Windows open Selva app files with this exe, offers it under Open with for
///     Grasshopper definitions, and adds a Start menu entry. All per user, so no elevation.
/// </summary>
internal static class ShellRegistration
{
    private const string Classes = @"Software\Classes";
    private const string AppFileProgId = "Selva.AppFile";
    private const string DefinitionProgId = "Selva.Definition";
    private const string ExeName = "SelvaApp.exe";

    private static readonly string[] DefinitionExtensions = { ".gh", ".ghx" };

    private static string ExePath => Assembly.GetExecutingAssembly().Location;

    private static string OpenCommand => $"\"{ExePath}\" \"%1\"";

    private static string ShortcutPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Selva.lnk");

    /// <summary>
    ///     Selva installs into a new folder with every version, which leaves the last
    ///     registration pointing at an exe that is gone.
    /// </summary>
    public static void RegisterIfStale()
    {
        using var command = Registry.CurrentUser.OpenSubKey($@"{Classes}\{AppFileProgId}\shell\open\command");
        if (!string.Equals(command?.GetValue(null) as string, OpenCommand, StringComparison.OrdinalIgnoreCase))
        {
            Register();
        }
    }

    public static void Register()
    {
        SetDefault($@"{Classes}\{AppFile.Extension}", AppFileProgId);
        RegisterProgId(AppFileProgId, "Selva app");

        // Double-click on a definition stays with Grasshopper: these only add Selva to Open with.
        RegisterProgId(DefinitionProgId, "Grasshopper definition");
        foreach (var extension in DefinitionExtensions)
        {
            using var openWith = Registry.CurrentUser.CreateSubKey($@"{Classes}\{extension}\OpenWithProgids");
            openWith.SetValue(DefinitionProgId, new byte[0], RegistryValueKind.None);
        }

        using (var application = Registry.CurrentUser.CreateSubKey($@"{Classes}\Applications\{ExeName}"))
        {
            application.SetValue("FriendlyAppName", "Selva");
        }

        SetDefault($@"{Classes}\Applications\{ExeName}\shell\open\command", OpenCommand);
        using (var types = Registry.CurrentUser.CreateSubKey($@"{Classes}\Applications\{ExeName}\SupportedTypes"))
        {
            types.SetValue(AppFile.Extension, "");
            foreach (var extension in DefinitionExtensions)
            {
                types.SetValue(extension, "");
            }
        }

        CreateShortcut();
        SHChangeNotify(AssociationChanged, 0, IntPtr.Zero, IntPtr.Zero);
    }

    public static void Unregister()
    {
        Registry.CurrentUser.DeleteSubKeyTree($@"{Classes}\{AppFile.Extension}", false);
        Registry.CurrentUser.DeleteSubKeyTree($@"{Classes}\{AppFileProgId}", false);
        Registry.CurrentUser.DeleteSubKeyTree($@"{Classes}\{DefinitionProgId}", false);
        Registry.CurrentUser.DeleteSubKeyTree($@"{Classes}\Applications\{ExeName}", false);
        foreach (var extension in DefinitionExtensions)
        {
            using var openWith = Registry.CurrentUser.OpenSubKey($@"{Classes}\{extension}\OpenWithProgids", true);
            openWith?.DeleteValue(DefinitionProgId, false);
        }

        File.Delete(ShortcutPath);
        SHChangeNotify(AssociationChanged, 0, IntPtr.Zero, IntPtr.Zero);
    }

    private static void RegisterProgId(string progId, string typeName)
    {
        SetDefault($@"{Classes}\{progId}", typeName);
        SetDefault($@"{Classes}\{progId}\DefaultIcon", $"\"{ExePath}\",0");
        SetDefault($@"{Classes}\{progId}\shell\open\command", OpenCommand);
    }

    private static void SetDefault(string keyPath, string value)
    {
        using var key = Registry.CurrentUser.CreateSubKey(keyPath);
        key.SetValue(null, value);
    }

    /// <summary>Through the Windows Script Host: .NET has no API that writes a .lnk.</summary>
    private static void CreateShortcut()
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null)
        {
            return;
        }

        object? shell = null;
        object? shortcut = null;
        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell,
                new object[] { ShortcutPath });
            var type = shortcut!.GetType();
            type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { ExePath });
            type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut,
                new object[] { "Run Grasshopper definitions as apps" });
            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
        catch (Exception ex) when (ex is COMException || ex is TargetInvocationException)
        {
            // No Start menu entry; the file type still opens.
        }
        finally
        {
            if (shortcut != null)
            {
                Marshal.FinalReleaseComObject(shortcut);
            }

            if (shell != null)
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }
    }

    private const int AssociationChanged = 0x08000000;

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);
}
