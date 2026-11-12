using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Selva.App;

internal sealed class RhinoWindow
{
    public RhinoWindow(IntPtr handle, string title)
    {
        Handle = handle;
        Title = title;
    }

    public IntPtr Handle { get; }

    /// <summary>Empty when the window has none.</summary>
    public string Title { get; }
}

/// <summary>
///     What the hidden Rhino has put on screen. Its main window is never shown, so a visible
///     window of its process is a dialog waiting for an answer: a licence prompt, crash recovery,
///     a missing plug-in. Such a dialog has no taskbar button and can sit behind every other
///     window.
/// </summary>
internal static class RhinoWindows
{
    /// <summary>
    ///     A visible top-level window of that process, one with a title when there is one; null
    ///     when it shows none.
    /// </summary>
    public static RhinoWindow? FindVisible(int processId)
    {
        RhinoWindow? found = null;
        EnumWindows((window, _) =>
        {
            GetWindowThreadProcessId(window, out var owner);

            // Frameworks keep visible windows of no size around; nobody is asked anything there.
            if (owner != (uint)processId || !IsWindowVisible(window) || !GetWindowRect(window, out var bounds) ||
                bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top)
            {
                return true;
            }

            var title = new StringBuilder(256);
            GetWindowText(window, title, title.Capacity);
            found = new RhinoWindow(window, title.ToString());
            return title.Length == 0;
        }, IntPtr.Zero);
        return found;
    }

    public static void BringToFront(IntPtr window)
    {
        SetForegroundWindow(window);
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr window, out Rect bounds);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);
}
