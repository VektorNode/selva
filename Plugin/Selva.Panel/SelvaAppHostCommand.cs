using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.Input;
using Selva.AppHost;

namespace Selva.RhinoPanel;

/// <summary>
///     Run by the Selva app in the Rhino it started: takes the name of the app's pipe and makes
///     this Rhino serve that app instead of its own panel. Not for people, so it's hidden.
/// </summary>
[Guid("B1E0F3A7-52C4-4D8E-9A6B-0C7D3E5F1A28")]
[CommandStyle(Style.Hidden)]
public class SelvaAppHostCommand : Command
{
    public override string EnglishName => AppHostProtocol.Command;

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        var plugIn = SelvaPanelPlugIn.Instance;
        if (plugIn == null)
        {
            return Result.Failure;
        }

        var pipeName = "";
        var result = RhinoGet.GetString("Pipe", false, ref pipeName);
        if (result != Result.Success || string.IsNullOrWhiteSpace(pipeName))
        {
            return Result.Nothing;
        }

        var refusal = plugIn.ServeApp(pipeName.Trim());
        if (refusal != null)
        {
            RhinoApp.WriteLine(refusal);
            return Result.Failure;
        }

        return Result.Success;
    }
}
