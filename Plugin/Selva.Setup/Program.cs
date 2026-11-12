#nullable enable
using System;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace Selva.Setup;

internal static class Program
{
    public const int Succeeded = 0;
    public const int Failed = 1;
    public const int RhinoRunning = 2;
    public const int NoRhino = 3;

    // SelvaSetup.exe                      the installer's window
    // SelvaSetup.exe /quiet               installs without a window, for deployment tools
    // SelvaSetup.exe /uninstall [/quiet]  removes Selva
    //
    // Quiet runs answer with an exit code: 0 done, 1 failed, 2 Rhino is running, 3 no Rhino 8 or 9.
    [STAThread]
    private static int Main(string[] args)
    {
        var uninstall = args.Any(arg => Is(arg, "uninstall"));
        if (args.Any(arg => Is(arg, "quiet")))
        {
            return RunQuiet(uninstall);
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm(uninstall));
        return Succeeded;
    }

    private static int RunQuiet(bool uninstall)
    {
        try
        {
            if (Installation.RhinoIsRunning())
            {
                return RhinoRunning;
            }

            if (uninstall)
            {
                Installation.Uninstall();
                return Succeeded;
            }

            var version = Installation.PayloadVersion();
            var targets = Installation.Targets();
            if (version == null)
            {
                return Failed;
            }

            if (targets.Count == 0)
            {
                return NoRhino;
            }

            Installation.Install(version, targets);
            return Succeeded;
        }
        catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException ||
                                   ex is InvalidDataException || ex is System.Security.SecurityException)
        {
            return Failed;
        }
    }

    private static bool Is(string argument, string name)
    {
        return string.Equals(argument.TrimStart('/', '-'), name, StringComparison.OrdinalIgnoreCase);
    }
}
