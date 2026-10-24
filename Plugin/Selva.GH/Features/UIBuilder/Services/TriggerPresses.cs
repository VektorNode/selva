using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Config;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Button inputs: a press assigns true and solves; the end of that solve puts false back.
/// </summary>
/// <remarks>
///     The reset has to land in the param's data. Clearing its contextual data isn't enough: the
///     param's volatile data stays true until it is expired, and the action would fire again the
///     next time anything downstream recomputes. A second solve straight away, like Grasshopper's
///     Button, would cost a full solve to undo nothing, so the param is expired without one.
///     UI thread only.
/// </remarks>
public sealed class TriggerPresses
{
    private readonly HashSet<Guid> _pressed = new HashSet<Guid>();

    /// <returns>False when the param isn't a boolean input any more.</returns>
    public bool Press(GH_Document document, Guid paramId)
    {
        if (!(document?.FindObject(paramId, false) is IGH_ContextualParameter param) ||
            !(param is IGH_ActiveObject active))
        {
            return false;
        }

        param.AssignContextualData(new[] { new GH_Boolean(true) });
        _pressed.Add(paramId);
        document.ScheduleSolution(AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs,
            _ => active.ExpireSolution(false));
        return true;
    }

    /// <summary>
    ///     Call after the post-solve contextual clear, outside the solution: it expires without
    ///     scheduling, so the next solve, whatever starts it, recomputes that branch with false.
    /// </summary>
    public void ResetPressed(GH_Document document)
    {
        if (_pressed.Count == 0 || document == null)
        {
            return;
        }

        foreach (var paramId in _pressed)
        {
            if (document.FindObject(paramId, false) is IGH_ContextualParameter param &&
                param is IGH_ActiveObject active)
            {
                param.AssignContextualData(new[] { new GH_Boolean(false) });
                active.ExpireSolution(false);
            }
        }

        _pressed.Clear();
    }

    public bool IsPressed(Guid paramId) => _pressed.Contains(paramId);
}
