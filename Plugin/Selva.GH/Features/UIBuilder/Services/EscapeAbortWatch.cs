using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using Grasshopper.Kernel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Aborts a solve on an Esc tap. Grasshopper's own check samples whether Esc is held at most
///     every 250 ms between components, so a quick tap usually falls between samples. This polls
///     on a background thread for the whole solve and asks for the abort itself, which Grasshopper
///     honours once the running component finishes. Windows only, like Grasshopper's check.
/// </summary>
public sealed class EscapeAbortWatch : IDisposable
{
    private const int VkEscape = 0x1B;
    private const int PollMs = 15;

    private static readonly bool IsWindows = RuntimeInformation.IsOSPlatform(OSPlatform.Windows);
    private static readonly int ProcessId = Process.GetCurrentProcess().Id;

    private readonly Timer _timer;
    private GH_Document _document;

    public EscapeAbortWatch()
    {
        _timer = new Timer(_ => Poll(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Start(GH_Document document)
    {
        if (!IsWindows || document == null)
        {
            return;
        }

        // Clears the pressed-since-last-call bit, so an Esc from before the solve doesn't abort it.
        GetAsyncKeyState(VkEscape);
        _document = document;
        _timer.Change(PollMs, PollMs);
    }

    public void Stop()
    {
        _timer.Change(Timeout.Infinite, Timeout.Infinite);
        _document = null;
    }

    public void Dispose()
    {
        Stop();
        _timer.Dispose();
    }

    private void Poll()
    {
        var document = _document;
        // The low bit catches a tap shorter than one poll. Esc only counts while Rhino is in front,
        // as in Grasshopper's own check.
        if (document == null || (GetAsyncKeyState(VkEscape) & 0x8001) == 0 || !RhinoIsForeground())
        {
            return;
        }

        // Only sets a flag the solver reads between components, so it's safe off the UI thread.
        document.RequestAbortSolution();
    }

    private static bool RhinoIsForeground()
    {
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            return false;
        }

        GetWindowThreadProcessId(window, out var processId);
        return processId == ProcessId;
    }

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out int processId);
}
