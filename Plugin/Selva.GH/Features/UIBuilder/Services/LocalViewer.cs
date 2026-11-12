using Selva.RhinoPanel;
using Selva.Schema.Models;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>Whether the plugin's own page shows the 3D viewer, and so whether a solve owes it display data.</summary>
internal static class LocalViewer
{
    /// <summary>
    ///     On with <c>enableLocal</c>. In the Selva app also with <c>enableRemote</c>: Rhino has no
    ///     window there, so the page's viewer is the only place geometry shows. The preview page
    ///     decides the same from its <c>host</c> query parameter. UI thread only.
    /// </summary>
    public static bool IsOn(UISchema schema)
    {
        var options = schema?.ViewerOptions;
        if (options == null)
        {
            return false;
        }

        return (options.EnableLocal ?? false) ||
               ((options.EnableRemote ?? false) && RhinoPanelHost.PageHost() == PanelContract.AppPageHost);
    }
}
