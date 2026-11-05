using System;
using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;

namespace Selva.RhinoPanel;

/// <summary>Gives the .gha a command context for UI that needs one: see <see cref="PanelContract.CommandActionSlot" />.</summary>
[Guid("9E4C2D71-5B3A-4F0E-8C6D-2A7B1E9F3C58")]
[CommandStyle(Style.Hidden)]
public class SelvaRunActionCommand : Command
{
    public override string EnglishName => PanelContract.RunActionCommand;

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        var action = AppDomain.CurrentDomain.GetData(PanelContract.CommandActionSlot) as Action;
        AppDomain.CurrentDomain.SetData(PanelContract.CommandActionSlot, null);
        action?.Invoke();
        return Result.Success;
    }
}
