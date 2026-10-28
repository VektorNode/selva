using System;
using System.Runtime.InteropServices;
using Grasshopper;
using Grasshopper.Kernel;
using Selva.GH.Utilities.Helpers;

namespace Selva.GH.Features.SolveRuntime.Services;

/// <summary>
///     Holds a macOS activity for the length of every Grasshopper solution. Without it, App Nap
///     throttles a Rhino hidden behind the browser, and each solve runs several times slower. Idle
///     system sleep stays allowed.
/// </summary>
internal static class MacSolveActivity
{
    private const string ObjC = "/usr/lib/libobjc.dylib";

    // NSActivityUserInitiatedAllowingIdleSystemSleep.
    private const ulong UserInitiatedAllowingIdleSystemSleep = 0x00EFFFFF;

    // Counted, not a flag: a SolutionEnd handler can start the next solution before ours runs.
    private static int _solving;
    private static IntPtr _activity;
    private static bool _failed;

    public static void Register()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            return;
        }

        Instances.DocumentServer.DocumentAdded += (_, doc) =>
        {
            doc.SolutionStart += OnSolutionStart;
            doc.SolutionEnd += OnSolutionEnd;
        };
        Instances.DocumentServer.DocumentRemoved += (_, doc) =>
        {
            doc.SolutionStart -= OnSolutionStart;
            doc.SolutionEnd -= OnSolutionEnd;
        };
    }

    private static void OnSolutionStart(object sender, GH_SolutionEventArgs e)
    {
        if (_solving++ == 0)
        {
            Begin();
        }
    }

    private static void OnSolutionEnd(object sender, GH_SolutionEventArgs e)
    {
        if (_solving > 0 && --_solving == 0)
        {
            End();
        }
    }

    // A failed call only costs speed, so it disables the activity rather than failing the solve.
    private static void Begin()
    {
        if (_failed || _activity != IntPtr.Zero)
        {
            return;
        }

        try
        {
            var reason = Send(Send(objc_getClass("NSString"), sel_registerName("alloc")),
                sel_registerName("initWithUTF8String:"), "Selva solve");
            _activity = Send(ProcessInfo(), sel_registerName("beginActivityWithOptions:reason:"),
                UserInitiatedAllowingIdleSystemSleep, reason);
            Send(_activity, sel_registerName("retain"));
            Send(reason, sel_registerName("release"));
        }
        catch (Exception ex)
        {
            _failed = true;
            _activity = IntPtr.Zero;
            Logger.Warn($"Could not keep Rhino out of App Nap during solves: {ex.Message}");
        }
    }

    private static void End()
    {
        if (_activity == IntPtr.Zero)
        {
            return;
        }

        try
        {
            Send(ProcessInfo(), sel_registerName("endActivity:"), _activity);
            Send(_activity, sel_registerName("release"));
        }
        catch (Exception ex)
        {
            _failed = true;
            Logger.Warn($"Could not end the App Nap activity: {ex.Message}");
        }

        _activity = IntPtr.Zero;
    }

    private static IntPtr ProcessInfo() => Send(objc_getClass("NSProcessInfo"), sel_registerName("processInfo"));

    [DllImport(ObjC)]
    private static extern IntPtr objc_getClass(string name);

    [DllImport(ObjC)]
    private static extern IntPtr sel_registerName(string name);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector, IntPtr arg);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector, string utf8);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector, ulong options, IntPtr reason);
}
