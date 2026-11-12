using System;
using System.Runtime.InteropServices;

namespace Selva.RhinoPanel;

/// <summary>
///     The AppKit call this plug-in makes on macOS, through the Objective-C runtime: it
///     references RhinoCommon only.
/// </summary>
internal static class MacApp
{
    private const string ObjC = "/usr/lib/libobjc.dylib";

    /// <summary>Hides this Rhino and all its windows, as Hide in its application menu does.</summary>
    public static void Hide()
    {
        var app = Send(objc_getClass("NSApplication"), sel_registerName("sharedApplication"));
        Send(app, sel_registerName("hide:"), IntPtr.Zero);
    }

    [DllImport(ObjC)]
    private static extern IntPtr objc_getClass(string name);

    [DllImport(ObjC)]
    private static extern IntPtr sel_registerName(string name);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern IntPtr Send(IntPtr receiver, IntPtr selector);

    [DllImport(ObjC, EntryPoint = "objc_msgSend")]
    private static extern void Send(IntPtr receiver, IntPtr selector, IntPtr argument);
}
