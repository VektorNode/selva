using System.Collections.Generic;
using Grasshopper.Kernel;
using Rhino;

namespace Selva.GH.Utilities.Helpers;

public static class GHDocumentMutator
{
    /// <param name="delayMs">
    ///     <see cref="Features.UIBuilder.Services.Communication.WebSocketTransport.ScheduleSolutionDelayMs" />
    ///     where a page is listening, so the panel paints "Solving…" before the solve takes the UI thread.
    /// </param>
    public static void ScheduleComponentExpire(GH_Document document, GH_Component component, int delayMs,
        bool immediate = false)
    {
        if (document == null)
        {
            return;
        }

        document.ScheduleSolution(delayMs,
            _ => { component?.ExpireSolution(immediate); });
    }

    public static void RefreshObjectsOnCanvas(GH_Document document, IEnumerable<IGH_ActiveObject> objects)
    {
        if (document == null || objects == null)
        {
            return;
        }

        RhinoApp.InvokeOnUiThread(() =>
        {
            foreach (var obj in objects)
            {
                obj?.ExpirePreview(true);
            }

            document.NewSolution(false);
        });
    }
}
