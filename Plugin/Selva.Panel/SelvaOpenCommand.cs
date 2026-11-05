using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Input;

namespace Selva.RhinoPanel;

/// <summary>
///     Opens a definition as a player session, for toolbars and scripts. Takes the path on the
///     command line; run interactively, Enter shows the Open dialog instead.
/// </summary>
/// <remarks>A toolbar macro runs interactive unless it starts with <c>-</c>, and still passes the path.</remarks>
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

        var interactive = mode == RunMode.Interactive;
        var path = "";
        var result = RhinoGet.GetString(
            interactive ? "Grasshopper definition to open. Press Enter to browse" : "Grasshopper definition to open",
            interactive, ref path);
        if (result != Result.Success && result != Result.Nothing)
        {
            return result;
        }

        path = path?.Trim().Trim('"') ?? "";
        if (path.Length == 0)
        {
            if (!interactive)
            {
                return Result.Nothing;
            }

            launcher.ShowOpenDialog();
            return Result.Success;
        }

        launcher.Open(path);
        return launcher.Error == null ? Result.Success : Result.Failure;
    }
}
