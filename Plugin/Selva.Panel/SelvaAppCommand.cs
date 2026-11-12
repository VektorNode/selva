using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Runtime;

namespace Selva.RhinoPanel;

/// <summary>
///     Starts the Selva app that ships with this plug-in. Its first start registers the app
///     file type and a Start menu entry, so this is how a new install gets them.
/// </summary>
[Guid("5D2A9C41-7E63-4B0F-8C1D-3F6A0B9E2D74")]
public class SelvaAppCommand : Command
{
    public override string EnglishName => "SelvaApp";

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        if (!HostUtils.RunningOnWindows)
        {
            RhinoApp.WriteLine("The Selva app is available on Windows only. Use the Selva panel instead.");
            return Result.Nothing;
        }

        var folder = Path.GetDirectoryName(typeof(SelvaAppCommand).Assembly.Location) ?? "";
        var exe = Path.Combine(folder, "app", "SelvaApp.exe");
        if (!File.Exists(exe))
        {
            RhinoApp.WriteLine("The Selva app is missing from this install. Reinstall Selva from the package manager.");
            return Result.Failure;
        }

        Process.Start(new ProcessStartInfo { FileName = exe, UseShellExecute = true });
        return Result.Success;
    }
}
