using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Selva.AppHost;

namespace Selva.App;

/// <summary>
///     The Rhino this app runs definitions in: a normal Rhino process whose window is never
///     shown, reached over a named pipe once Selva's panel plug-in in it has connected. Events
///     are raised on the thread that created this.
/// </summary>
internal sealed class RhinoHost
{
    // A cold Rhino on a slow disk: start, then load the panel plug-in and connect.
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan QuitTimeout = TimeSpan.FromSeconds(8);

    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    private readonly SynchronizationContext _ui;
    private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
    private readonly object _writeLock = new object();

    private NamedPipeServerStream? _pipe;
    private StreamWriter? _writer;
    private Process? _rhino;
    private volatile bool _quitting;
    private int _failed;

    public RhinoHost()
    {
        _ui = SynchronizationContext.Current ?? new SynchronizationContext();
    }

    /// <summary>A message from Rhino, as <see cref="AppHostProtocol" /> describes.</summary>
    public event Action<IDictionary<string, string?>>? Message;

    /// <summary>Rhino couldn't be started, or went away. The message is for the user. Raised once.</summary>
    public event Action<string>? Failed;

    /// <summary>Returns at once; <see cref="AppHostProtocol.Ready" /> arrives when Rhino is up.</summary>
    public void Start()
    {
        new Thread(Run) { IsBackground = true, Name = "Selva Rhino host" }.Start();
    }

    public void Send(string type, params KeyValuePair<string, string?>[] fields)
    {
        var writer = _writer;
        if (writer == null)
        {
            return;
        }

        var message = new Dictionary<string, object?> { [AppHostProtocol.TypeField] = type };
        foreach (var field in fields)
        {
            message[field.Key] = field.Value;
        }

        try
        {
            lock (_writeLock)
            {
                writer.WriteLine(_json.Serialize(message));
            }
        }
        catch (Exception ex) when (ex is IOException || ex is ObjectDisposedException)
        {
            Fail("Rhino closed unexpectedly.");
        }
    }

    /// <summary>
    ///     Asks Rhino to exit and makes sure it has: a Rhino nobody can see would keep its
    ///     licence and its memory. Blocks for up to <see cref="QuitTimeout" />.
    /// </summary>
    public void Quit()
    {
        _quitting = true;
        Send(AppHostProtocol.Quit);

        var rhino = _rhino;
        if (rhino != null)
        {
            try
            {
                if (_writer == null || !rhino.WaitForExit((int)QuitTimeout.TotalMilliseconds))
                {
                    rhino.Kill();
                }
            }
            catch (Exception ex) when (ex is InvalidOperationException ||
                                       ex is System.ComponentModel.Win32Exception)
            {
                // Already gone.
            }
        }

        _pipe?.Dispose();
    }

    private void Run()
    {
        var installed = InstalledRhinos();
        if (installed.Count == 0)
        {
            Fail("Rhino isn't installed on this computer. Selva needs Rhino 8 or Rhino 9.");
            return;
        }

        string? problem = null;
        foreach (var rhino in installed)
        {
            if (_quitting)
            {
                return;
            }

            if (TryStart(rhino.ExePath))
            {
                return;
            }

            problem = rhino.HasSelva
                ? "Rhino didn't start. Open Rhino once to check that it runs and has a licence, then try again."
                : "Selva isn't installed in Rhino. Install it from Rhino's package manager " +
                  "(type PackageManager in Rhino), then try again.";
        }

        Fail(problem!);
    }

    private bool TryStart(string exePath)
    {
        var pipeName = "selva-app-" + Guid.NewGuid().ToString("N");
        var pipe = CreatePipe(pipeName);
        var connected = pipe.BeginWaitForConnection(null, null);

        Process process;
        try
        {
            // Shell-executed: .NET Framework applies WindowStyle only on that path. Hidden is what
            // keeps Rhino's main window, and with it every panel and the Grasshopper editor, off
            // screen for the life of the process.
            process = Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                Arguments = "/nosplash /notemplate /runscript=\"_-" + AppHostProtocol.Command + " " + pipeName + "\"",
                WindowStyle = ProcessWindowStyle.Hidden,
                UseShellExecute = true
            })!;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception || ex is FileNotFoundException)
        {
            pipe.Dispose();
            return false;
        }

        _rhino = process;
        var deadline = DateTime.UtcNow + StartTimeout;
        while (!connected.AsyncWaitHandle.WaitOne(250))
        {
            if (_quitting || process.HasExited || DateTime.UtcNow > deadline)
            {
                // Still running means it may be sitting on a dialog nobody can see.
                Kill(process);
                pipe.Dispose();
                _rhino = null;
                return false;
            }
        }

        pipe.EndWaitForConnection(connected);
        _pipe = pipe;
        _writer = new StreamWriter(pipe, Utf8) { AutoFlush = true, NewLine = "\n" };
        new Thread(ReadLoop) { IsBackground = true, Name = "Selva Rhino pipe" }.Start();
        return true;
    }

    private void ReadLoop()
    {
        try
        {
            using var reader = new StreamReader(_pipe!, Utf8, false, 4096, true);
            string? line;
            while ((line = reader.ReadLine()) != null)
            {
                Dispatch(line);
            }
        }
        catch (Exception ex) when (ex is IOException || ex is ObjectDisposedException)
        {
            // Rhino closed its end.
        }

        Fail("Rhino closed unexpectedly.");
    }

    private void Dispatch(string line)
    {
        Dictionary<string, object?>? raw;
        try
        {
            raw = _json.Deserialize<Dictionary<string, object?>>(line);
        }
        catch (Exception ex) when (ex is ArgumentException || ex is InvalidOperationException)
        {
            return;
        }

        if (raw == null)
        {
            return;
        }

        var message = raw.ToDictionary(pair => pair.Key, pair => pair.Value?.ToString());
        _ui.Post(_ => Message?.Invoke(message), null);
    }

    private void Fail(string message)
    {
        if (_quitting || Interlocked.Exchange(ref _failed, 1) != 0)
        {
            return;
        }

        _ui.Post(_ => Failed?.Invoke(message), null);
    }

    private static void Kill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill();
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException || ex is System.ComponentModel.Win32Exception)
        {
            // Already gone.
        }
    }

    /// <summary>
    ///     Rhinos that have Selva first, and among those the one this exe was installed into:
    ///     Selva's package folder is per Rhino version, and the exe sits in it.
    /// </summary>
    private static List<RhinoInstall> InstalledRhinos()
    {
        var ownFolder = AppDomain.CurrentDomain.BaseDirectory;
        return RhinoInstalls.Find()
            .OrderByDescending(rhino => ownFolder.StartsWith(rhino.SelvaFolder + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(rhino => rhino.HasSelva)
            .ToList();
    }

    /// <summary>
    ///     Only this user may connect: a protected app's key travels over the pipe, and the
    ///     default pipe ACL lets everyone on the machine read.
    /// </summary>
    private static NamedPipeServerStream CreatePipe(string name)
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!,
            PipeAccessRights.FullControl, AccessControlType.Allow));
        return new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous, 4096, 4096, security);
    }
}
