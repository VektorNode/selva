using System;
using Grasshopper.Kernel;
using Selva.GH.Features.Drawing.Goos;

namespace Selva.GH.Features.Drawing.Params;

public class Param_Fill : GH_Param<FillGoo>
{
    public Param_Fill()
        : base("Param Fill", "PFil",
            "Fill style (color, opacity, hatch pattern)",
            "Selva", "Elements", GH_ParamAccess.item)
    { }

    public Param_Fill(GH_InstanceDescription tag) : base(tag) { }

    public Param_Fill(string name, string nickname, string description,
        string category, string subcategory, GH_ParamAccess access)
        : base(name, nickname, description, category, subcategory, access) { }

    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("dca597e4-5d62-4186-9d78-e60c3da99e85");

    protected override FillGoo InstantiateT() => new FillGoo();
}
