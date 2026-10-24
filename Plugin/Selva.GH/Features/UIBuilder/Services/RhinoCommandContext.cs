using System;
using System.Runtime.ExceptionServices;
using Rhino;
using Rhino.Commands;
using Selva.RhinoPanel;

namespace Selva.GH.Features.UIBuilder.Services;

/// <summary>
///     Runs an action inside a Rhino command. A viewport getter started outside one prompts but
///     never finishes on Mac: the selection lands and the prompt stays. A .gha can't register a
///     command, so Selva.Panel.rhp hosts one. UI thread only.
/// </summary>
internal static class RhinoCommandContext
{
    public static void Run(Action action)
    {
        if (!Command.InCommand())
        {
            var ran = false;
            ExceptionDispatchInfo failure = null;
            // Caught here: Rhino's command dispatcher swallows what a command throws.
            AppDomain.CurrentDomain.SetData(PanelContract.CommandActionSlot, (Action)(() =>
            {
                ran = true;
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    failure = ExceptionDispatchInfo.Capture(ex);
                }
            }));

            // Synchronous outside a command. Without the .rhp the command is unknown and nothing ran.
            RhinoApp.RunScript("_" + PanelContract.RunActionCommand, false);
            AppDomain.CurrentDomain.SetData(PanelContract.CommandActionSlot, null);
            if (ran)
            {
                failure?.Throw();
                return;
            }
        }

        action();
    }
}
