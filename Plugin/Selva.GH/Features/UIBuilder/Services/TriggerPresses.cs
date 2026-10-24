using System;
using System.Collections.Generic;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Config;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Button inputs: a press assigns true and solves; the end of that solve puts false back.
/// </summary>
/// <remarks>
///     The reset has to land in the param's data. Clearing its contextual data isn't enough: the
///     param's volatile data stays true, and the action would fire again the next time anything
///     downstream recomputes. Expiring the param is too much: that clears everything downstream,
///     so the press's own results leave the viewport and the Context Bakes. The reset swaps the
///     param's volatile data for false in place. Downstream keeps what the press produced and reads
///     false the next time it recomputes. A second solve straight away, like Grasshopper's Button,
///     would cost a full solve to undo nothing. UI thread only.
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
    ///     Call from SolutionEnd, after the post-solve contextual clear, never from a later tick: a
    ///     press queued behind this solve would run first and be reset before its own solve.
    /// </summary>
    /// <remarks>
    ///     Every press here has had its solve: a press needs the bridge idle, and Grasshopper runs a
    ///     schedule's callbacks at the start of whichever solve comes next.
    /// </remarks>
    public void ResetPressed(GH_Document document)
    {
        if (_pressed.Count == 0 || document == null)
        {
            return;
        }

        foreach (var paramId in _pressed)
        {
            if (document.FindObject(paramId, false) is IGH_Param param)
            {
                var path = param.VolatileData.PathCount > 0 ? param.VolatileData.Paths[0] : new GH_Path(0);
                param.ClearData();
                param.AddVolatileData(path, 0, new GH_Boolean(false));
                // ClearData marked the param expired, but the data it now holds is current.
                param.Phase = GH_SolutionPhase.Computed;
            }
        }

        _pressed.Clear();
    }
}
