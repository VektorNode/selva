using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Button inputs: a press assigns true and solves; the end of that solve assigns false and
///     solves once more, the way Grasshopper's Button does on release.
/// </summary>
/// <remarks>
///     Swapping the param's data for false without that second solve leaves everything downstream
///     showing true (a Content Cache's Action, a Panel) until something else recomputes it. Like
///     Grasshopper's Button, what a component produces only on true goes away with the release.
///     UI thread only.
/// </remarks>
public sealed class TriggerPresses
{
    private readonly HashSet<Guid> _pressed = new HashSet<Guid>();

    /// <param name="scheduleDelayMs">How long the press's solve waits to start.</param>
    /// <returns>False when the param isn't a boolean input any more.</returns>
    public bool Press(GH_Document document, Guid paramId, int scheduleDelayMs)
    {
        if (!(document?.FindObject(paramId, false) is IGH_ContextualParameter param) ||
            !(param is IGH_Param ghParam) || ghParam.Type != typeof(GH_Boolean) ||
            !(param is IGH_ActiveObject active))
        {
            return false;
        }

        param.AssignContextualData(new[] { new GH_Boolean(true) });
        _pressed.Add(paramId);
        document.ScheduleSolution(scheduleDelayMs, _ => active.ExpireSolution(false));
        return true;
    }

    /// <summary>
    ///     Call from SolutionEnd, after the post-solve contextual clear, never from a later tick: a
    ///     press queued behind this solve would run first and be reset before its own solve.
    /// </summary>
    /// <remarks>
    ///     Every press here has had its solve: a press needs the bridge idle, and Grasshopper runs a
    ///     schedule's callbacks at the start of whichever solve comes next. The release's own
    ///     SolutionEnd finds nothing pressed, so it doesn't release again.
    /// </remarks>
    /// <returns>True when the release scheduled a solve.</returns>
    public bool ResetPressed(GH_Document document, int scheduleDelayMs)
    {
        if (_pressed.Count == 0 || document == null)
        {
            return false;
        }

        var released = new List<IGH_ActiveObject>();
        foreach (var paramId in _pressed)
        {
            if (document.FindObject(paramId, false) is IGH_ContextualParameter param &&
                param is IGH_ActiveObject active)
            {
                param.AssignContextualData(new[] { new GH_Boolean(false) });
                released.Add(active);
            }
        }

        _pressed.Clear();
        if (released.Count == 0)
        {
            return false;
        }

        document.ScheduleSolution(scheduleDelayMs, _ =>
        {
            foreach (var active in released)
            {
                active.ExpireSolution(false);
            }
        });
        return true;
    }
}
