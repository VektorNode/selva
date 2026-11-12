using System;
using System.Windows.Forms;
using Selva.AppFormat;

namespace Selva.App;

internal static class Program
{
    // SelvaApp.exe                     the launcher
    // SelvaApp.exe <file>              that app file or definition, as its own window
    // SelvaApp.exe --register          file type, Open with and Start menu entry for this user
    // SelvaApp.exe --unregister        removes them
    // SelvaApp.exe --add-key <key>     stores a protected app's key, so this user is never asked for it
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0)
        {
            switch (args[0])
            {
                case "--register":
                    ShellRegistration.Register();
                    return 0;

                case "--unregister":
                    ShellRegistration.Unregister();
                    return 0;

                case "--add-key":
                    if (args.Length != 2 || args[1].Length == 0)
                    {
                        return 1;
                    }

                    KeyStore.Write(AppFileKey.Hex(AppFileKey.IdOf(args[1])), args[1]);
                    return 0;
            }
        }

        try
        {
            ShellRegistration.RegisterIfStale();
        }
        catch (Exception ex) when (ex is UnauthorizedAccessException || ex is System.Security.SecurityException ||
                                   ex is System.IO.IOException)
        {
            // A locked-down registry only costs the double-click; the app still runs.
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm(args.Length > 0 ? args[0] : null));
        return 0;
    }
}
