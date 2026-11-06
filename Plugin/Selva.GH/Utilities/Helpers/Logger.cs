using System;
using Rhino;

namespace Selva.GH.Utilities.Helpers;

public static class Logger
{
    public static void Log(string message)
    {
        if (DevMode.Enabled)
        {
            DevLog.Write("debug", message);
        }
#if DEBUG
        RhinoApp.WriteLine($"[Selva] {message}");
#endif
    }

    /// <summary>
    ///     Dev log only, never the command line: too frequent for it. Guard a call that builds its
    ///     message with <c>if (DevMode.Enabled)</c>, so a released install doesn't pay for the string.
    /// </summary>
    public static void Trace(string message)
    {
        if (DevMode.Enabled)
        {
            DevLog.Write("trace", message);
        }
    }

    public static void Error(string message, Exception ex = null)
    {
        if (DevMode.Enabled)
        {
            DevLog.Write("error", message, ex);
        }

        RhinoApp.WriteLine($"[Selva Error] {message}");
        if (ex != null)
        {
            RhinoApp.WriteLine($"[Selva Error Details] {ex.Message}");
            RhinoApp.WriteLine($"[Selva Error Stack] {ex.StackTrace}");
        }
    }

    public static void Warn(string message)
    {
        if (DevMode.Enabled)
        {
            DevLog.Write("warn", message);
        }

        RhinoApp.WriteLine($"[Selva Warning] {message}");
    }
}
