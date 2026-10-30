#nullable enable
using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Rhino;
using Rhino.PlugIns;
using Selva.RhinoPanel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>Drives the Rhino panel that <c>Selva.Panel.rhp</c> registers. UI thread only.</summary>
internal static class RhinoPanelHost
{
    private static readonly Guid PlugInId = new Guid(PanelContract.PlugInId);

    /// <summary>Null when the panel took the session; otherwise why it couldn't, for the user.</summary>
    public static string? TryShow(string url, string sessionId, GH_Document document, bool raise)
    {
        // Loads the .rhp if it isn't yet.
        var contract = RhinoApp.GetPlugInObject(PlugInId) as IDictionary<string, object>;
        if (contract == null)
        {
            return "Selva.Panel.rhp is not installed next to Selva.gha. Reinstall Selva from the package manager.";
        }

        if (!contract.TryGetValue(PanelContract.VersionKey, out var version) ||
            !(version is int v) || v != PanelContract.Version ||
            !contract.TryGetValue(PanelContract.ShowKey, out var showValue) ||
            !(showValue is Action<string, string, bool> show))
        {
            return "Selva.Panel.rhp and Selva.gha come from different Selva versions. Reinstall Selva " +
                   "from the package manager.";
        }

        show(url, sessionId, raise);
        PanelPreview.Show(document, sessionId);
        return null;
    }

    /// <summary>Retargets a panel already in use. Never loads the .rhp or opens the panel.</summary>
    public static void Follow(string url, string sessionId, GH_Document document)
    {
        if (LoadedContract()?.TryGetValue(PanelContract.FollowKey, out var followValue) == true &&
            followValue is Action<string, string> follow)
        {
            follow(url, sessionId);
            PanelPreview.Show(document, sessionId);
        }
    }

    public static void Clear(string sessionId)
    {
        PanelPreview.Clear(sessionId);

        if (LoadedContract()?.TryGetValue(PanelContract.ClearKey, out var clearValue) == true &&
            clearValue is Action<string> clear)
        {
            clear(sessionId);
        }
    }

    /// <summary>Shows a player session's failure in the panel's launcher.</summary>
    public static void Notify(string message)
    {
        if (LoadedContract()?.TryGetValue(PanelContract.NotifyKey, out var notifyValue) == true &&
            notifyValue is Action<string> notify)
        {
            notify(message);
        }
    }

    // Find, not GetPlugInObject: clearing or notifying must not load the .rhp.
    private static IDictionary<string, object>? LoadedContract()
    {
        return PlugIn.Find(PlugInId)?.GetPlugInObject() as IDictionary<string, object>;
    }
}
