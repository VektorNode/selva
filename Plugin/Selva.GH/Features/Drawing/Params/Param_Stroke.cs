using System;
using Grasshopper.Kernel;
using Selva.GH.Features.Drawing.Goos;

namespace Selva.GH.Features.Drawing.Params;

public class Param_Stroke : GH_Param<StrokeGoo>
{
    public Param_Stroke()
        : base("Param Stroke", "PStr",
            "Stroke style (color, width, dash, caps)",
            "Selva", "Elements", GH_ParamAccess.item)
    { }

    public Param_Stroke(GH_InstanceDescription tag) : base(tag) { }

    public Param_Stroke(string name, string nickname, string description,
        string category, string subcategory, GH_ParamAccess access)
        : base(name, nickname, description, category, subcategory, access) { }

    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("3950b9b1-af31-4bb0-9709-bdcf8e51ebb1");

    protected override StrokeGoo InstantiateT() => new StrokeGoo();
}
