using System.Collections.Generic;
using Grasshopper.Kernel;
using Rhino;
using Selva.GH.Config;

namespace Selva.GH.Utilities.Helpers;

public static class GHDocumentMutator
{
    /// <summary>Delay comes from AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs.</summary>
    public static void ScheduleComponentExpire(GH_Document document, GH_Component component, bool immediate = false)
    {
        if (document == null)
        {
            return;
        }

        document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs,
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
