using System;
using Grasshopper.Kernel;
using Selva.GH.Features.Drawing.Goos;

namespace Selva.GH.Features.Drawing.Params;

public class Param_TextStyle : GH_Param<TextStyleGoo>
{
    public Param_TextStyle()
        : base("Param Text Style", "PTS",
            "Text style (font, size, color, alignment)",
            "Params", "Selva", GH_ParamAccess.item)
    { }

    public Param_TextStyle(GH_InstanceDescription tag) : base(tag) { }

    public Param_TextStyle(string name, string nickname, string description,
        string category, string subcategory, GH_ParamAccess access)
        : base(name, nickname, description, category, subcategory, access) { }

    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("9a941065-e00f-439a-86de-ce58a39c287d");

    protected override TextStyleGoo InstantiateT() => new TextStyleGoo();
}
