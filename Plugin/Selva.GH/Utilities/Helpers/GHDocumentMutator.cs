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

            // Schedule rather than NewSolution: callers reach here from the WebSocket handler, which
            // can land mid-solve, and NewSolution re-enters the solver. Scheduling defers to the gap
            // after the current solution instead of dropping the refresh.
            document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs);
        });
    }
}
