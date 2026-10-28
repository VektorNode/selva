using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.PlugIns;
using Rhino.UI;
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
            [PanelContract.ShowKey] = (Action<string, string>)Show,
            [PanelContract.ClearKey] = (Action<string>)Clear,
            [PanelContract.NotifyKey] = (Action<string>)Launcher.Notify
        };
    }

    private void Show(string url, string sessionId)
    {
        Host.Show(new PanelTarget(new Uri(url), sessionId));
    }

    private void Clear(string sessionId)
    {
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
}

internal sealed record PanelTarget(Uri Url, string SessionId);
