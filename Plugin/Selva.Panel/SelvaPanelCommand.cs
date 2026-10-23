using System.Runtime.InteropServices;
using Rhino;
using Rhino.Commands;
using Rhino.UI;

namespace Selva.RhinoPanel;

/// <summary>Lets users put the panel on a toolbar or a shortcut.</summary>
[Guid("01582028-711D-43DB-A820-5CC73D8BDA60")]
public class SelvaPanelCommand : Command
{
    public override string EnglishName => "SelvaPanel";

    protected override Result RunCommand(RhinoDoc doc, RunMode mode)
    {
        Panels.OpenPanel(typeof(SelvaPanel).GUID);
        return Result.Success;
    }
}
