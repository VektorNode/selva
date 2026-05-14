using System;
using Grasshopper.Kernel;
using Selva.GH.Features.Drawing.Goos;

namespace Selva.GH.Features.Drawing.Params;

public class Param_PathStyle : GH_Param<PathStyleGoo>
{
    public Param_PathStyle()
        : base("Param Path Style", "PPS",
            "Path style bundle (stroke + fill)",
            "Selva", "Elements", GH_ParamAccess.item)
    { }

    public Param_PathStyle(GH_InstanceDescription tag) : base(tag) { }

    public Param_PathStyle(string name, string nickname, string description,
        string category, string subcategory, GH_ParamAccess access)
        : base(name, nickname, description, category, subcategory, access) { }

    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("887d0b52-b94d-4e4c-8150-587802e9977e");

    protected override PathStyleGoo InstantiateT() => new PathStyleGoo();
}
