using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Rhino;
using Rhino.PlugIns;
using Rhino.UI;
using Selva.AppHost;
using Selva.RhinoPanel;

[assembly: Guid(PanelContract.PlugInId)]

namespace Selva.RhinoPanel;

/// <summary>
///     Exists only because every <c>Panels.RegisterPanel</c> overload needs a <see cref="PlugIn" />
///     and a .gha has none. Owns the <see cref="SelvaWebHost" />: on Mac, Rhino can create and
///     destroy the panel more than once, so each new instance reads the current state from here.
/// </summary>
public class SelvaPanelPlugIn : PlugIn
{
    // While the Selva app hosts this Rhino, sessions go to the app's window instead of the panel.
    private AppHostLink? _app;
    private string? _appSessionId;
    private OpenStep? _reportedStep;
    private string? _reportedError;

    public SelvaPanelPlugIn()
    {
        Instance = this;
    }

    internal static SelvaPanelPlugIn? Instance { get; private set; }

    /// <summary>Rhino restores a docked panel at startup, before Grasshopper has loaded.</summary>
    public override PlugInLoadTime LoadTime => PlugInLoadTime.WhenNeededOrTabbedDockBar;

    internal SelvaWebHost Host { get; private set; } = null!;

    internal DefinitionLauncherClient Launcher { get; private set; } = null!;

    protected override LoadReturnCode OnLoad(ref string errorMessage)
    {
        Launcher = new DefinitionLauncherClient(Settings);
        Host = new SelvaWebHost(Launcher.ShowOpenDialog);
        Launcher.IsShowingSession = () => Host.View != null;
        Launcher.IsInWindow = () => Host.InWindow;
        Launcher.Changed += CloseWindowAfterFailedOpen;
        Launcher.Changed += SelvaPanel.RenderAll;
        Launcher.Changed += ReportToApp;
        Host.Changed += SelvaPanel.RenderAll;
        Host.PageLoaded += Launcher.SessionShown;

        // System, not the PerDoc default: on Mac PerDoc gives every document window its own panel.
        Panels.RegisterPanel(this, typeof(SelvaPanel), "Selva", typeof(SelvaPanelPlugIn).Assembly,
            "Selva.Panel.Icon.png", PanelType.System);
        RhinoApp.Closing += (_, _) => Host.BeginShutdown();
        return LoadReturnCode.Success;
    }

    public override object GetPlugInObject()
    {
        return new Dictionary<string, object>
        {
            [PanelContract.VersionKey] = PanelContract.Version,
            [PanelContract.ShowKey] = (Action<string, string, bool>)Show,
            [PanelContract.FollowKey] = (Action<string, string>)Follow,
            [PanelContract.ClearKey] = (Action<string>)Clear,
            [PanelContract.NotifyKey] = (Action<string>)Launcher.Notify,
            [PanelContract.PageHostKey] = (Func<string>)(() =>
                _app != null ? PanelContract.AppPageHost : PanelContract.PanelPageHost)
        };
    }

    private void Show(string url, string sessionId, bool raise)
    {
        if (_app != null)
        {
            ShowInApp(url, sessionId);
            return;
        }

        Host.Show(new PanelTarget(new Uri(url), sessionId), raise);
    }

    private void Follow(string url, string sessionId)
    {
        if (_app != null)
        {
            ShowInApp(url, sessionId);
            return;
        }

        Host.Retarget(new PanelTarget(new Uri(url), sessionId));
    }

    private void Clear(string sessionId)
    {
        if (_app != null)
        {
            if (_appSessionId == sessionId)
            {
                _appSessionId = null;

                // Opening another definition clears the old session first; the app waits for the new one.
                if (!Launcher.IsOpening)
                {
                    _app.Send(AppHostProtocol.Clear);
                }
            }

            return;
        }

        if (Host.Shown?.SessionId == sessionId)
        {
            // Opening another definition clears the old session first; a pop-out waits for the new one.
            Host.Clear(keepWindow: Launcher.IsOpening);
        }
    }

    /// <summary>A pop-out kept for an open that then failed: the error shows in the panel's launcher.</summary>
    private void CloseWindowAfterFailedOpen()
    {
        if (!Launcher.IsOpening && Host.Shown == null && Host.InWindow)
        {
            Host.Clear();
            Panels.OpenPanel(typeof(SelvaPanel).GUID);
        }
    }

    // ============================================================================
    // Hosted by the Selva app
    // ============================================================================

    /// <returns>Null when this Rhino now serves the app listening there; otherwise why not.</returns>
    internal string? ServeApp(string address)
    {
        if (_app != null)
        {
            return "This Rhino already serves a Selva app.";
        }

        var link = AppHostLink.Connect(address, out var error);
        if (link == null)
        {
            // The app went away while this Rhino started. Nobody can see it to close it, and it
            // holds a licence. Queued from another thread so it runs after the command that
            // called this has returned, as the link's Ended does.
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows) &&
                !IsWindowVisible(RhinoApp.MainWindowHandle()))
            {
                Task.Run(() => RhinoApp.InvokeOnUiThread(new Action(ExitRhino)));
            }

            return error;
        }

        _app = link;
        Launcher.HostedByApp = true;
        link.OpenRequested += (path, key) => Launcher.Open(path, key);
        link.CloseRequested += Launcher.CloseDefinition;
        link.Ended += ExitRhino;
        link.Send(AppHostProtocol.Ready, (AppHostProtocol.RhinoField, RhinoApp.Version.ToString()));
        return null;
    }

    private void ShowInApp(string url, string sessionId)
    {
        _appSessionId = sessionId;
        _app!.Send(AppHostProtocol.Show,
            (AppHostProtocol.UrlField, url),
            (AppHostProtocol.SessionIdField, sessionId));
        Launcher.SessionShown();
    }

    /// <summary>The app draws what the idle panel would: each step of an open, and why one failed.</summary>
    private void ReportToApp()
    {
        if (_app == null)
        {
            return;
        }

        if (Launcher.Step != _reportedStep)
        {
            _reportedStep = Launcher.Step;
            if (_reportedStep is OpenStep step)
            {
                _app.Send(AppHostProtocol.Step, (AppHostProtocol.StepField, step.ToString()));
            }
        }

        if (Launcher.Error != _reportedError)
        {
            _reportedError = Launcher.Error;
            if (_reportedError != null)
            {
                _app.Send(AppHostProtocol.Error, (AppHostProtocol.MessageField, _reportedError));
            }
        }
    }

    private void ExitRhino()
    {
        Launcher.CloseDefinition();

        // A definition may have baked into the document, and nobody can answer Rhino's save
        // prompt: its window was never shown.
        foreach (var doc in RhinoDoc.OpenDocuments())
        {
            doc.Modified = false;
        }

        // Forced: a hidden Rhino on a Mac ignores the Exit that lets the user cancel.
        RhinoApp.Exit(false);
    }

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
}

internal sealed record PanelTarget(Uri Url, string SessionId);
