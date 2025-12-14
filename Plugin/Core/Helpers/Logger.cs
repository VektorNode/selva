using System;
using Rhino;

namespace Selva.Core.Helpers
{
  public static class Logger
  {
    public static void Log(string message)
    {
#if DEBUG
      RhinoApp.WriteLine($"[Selva] {message}");
#endif
    }

    public static void Error(string message, Exception ex = null)
    {
      RhinoApp.WriteLine($"[Selva Error] {message}");
      if (ex != null)
      {
        RhinoApp.WriteLine($"[Selva Error Details] {ex.Message}");
        RhinoApp.WriteLine($"[Selva Error Stack] {ex.StackTrace}");
      }
    }

    public static void Warn(string message)
    {
      RhinoApp.WriteLine($"[Selva Warning] {message}");
    }
  }
}
