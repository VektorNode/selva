#nullable enable
using System;
using System.Collections.Generic;
using Rhino;
using Rhino.PlugIns;
using Selva.RhinoPanel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>Drives the Rhino panel that <c>Selva.Panel.rhp</c> registers. UI thread only.</summary>
internal static class RhinoPanelHost
{
    private static readonly Guid PlugInId = new Guid(PanelContract.PlugInId);

    /// <summary>Null when the panel took the session; otherwise why it couldn't, for the user.</summary>
    public static string? TryShow(string url, string sessionId)
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
            !(showValue is Action<string, string> show))
        {
            return "Selva.Panel.rhp and Selva.gha come from different Selva versions. Reinstall Selva " +
                   "from the package manager.";
        }

        show(url, sessionId);
        return null;
    }

    public static void Clear(string sessionId)
    {
        // Find, not GetPlugInObject: clearing must not load the .rhp.
        var contract = PlugIn.Find(PlugInId)?.GetPlugInObject() as IDictionary<string, object>;
        if (contract != null &&
            contract.TryGetValue(PanelContract.ClearKey, out var clearValue) &&
            clearValue is Action<string> clear)
        {
            clear(sessionId);
        }
    }
}
