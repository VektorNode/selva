using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Selva.App;

/// <summary>Follows Windows' light or dark app setting. Compiled into the app and its installer.</summary>
internal static class WindowsTheme
{
    public static bool IsDark()
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }

    /// <summary>
    ///     Without this a dark window keeps a white title bar. Windows 10 before 20H1 doesn't
    ///     know the attribute and ignores it.
    /// </summary>
    public static void UseDarkTitleBar(IntPtr window)
    {
        var enabled = 1;
        DwmSetWindowAttribute(window, ImmersiveDarkMode, ref enabled, sizeof(int));
    }

    private const int ImmersiveDarkMode = 20;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
