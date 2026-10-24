using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Input;

namespace Selva.RhinoPanel;

/// <summary>Opens a definition as a player session, for toolbars and scripts. Scripted, it takes the path.</summary>
[Guid("3C0B2F6E-8D0A-4B57-9E1A-6A1D2B7C4F90")]
public class SelvaOpenCommand : Command
{
    public override string EnglishName => "SelvaOpen";

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        var launcher = SelvaPanelPlugIn.Instance?.Launcher;
        if (launcher == null)
        {
            return Result.Failure;
        }

        if (mode == RunMode.Interactive)
        {
            launcher.ShowOpenDialog();
            return Result.Success;
        }

        var path = "";
        var result = RhinoGet.GetString("Grasshopper definition to open", false, ref path);
        if (result != Result.Success)
        {
            return result;
        }

        launcher.Open(path.Trim('"'));
        return launcher.Error == null ? Result.Success : Result.Failure;
    }
}
