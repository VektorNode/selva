using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Params;

public class Param_ThreeMaterial : GH_Param<ThreeMaterialGoo>
{
    public Param_ThreeMaterial()
        : base(
            "Material", "M",
            "A Three.js-compatible material (color, metalness, roughness, opacity)",
            "Selva", "Display",
            GH_ParamAccess.item)
    {
    }

    public Param_ThreeMaterial(GH_InstanceDescription tag) : base(tag)
    {
    }

    public Param_ThreeMaterial(
        string name, string nickname, string description,
        string category, string subcategory,
        GH_ParamAccess access)
        : base(name, nickname, description, category, subcategory, access)
    {
    }

    protected override Bitmap Icon => Resources.ThreeMaterial;

    public override GH_Exposure Exposure => GH_Exposure.tertiary;

    public override Guid ComponentGuid => new Guid("A1C3E5F7-B2D4-4A6C-8E0F-1234567890AB");

    protected override ThreeMaterialGoo InstantiateT()
    {
        return new ThreeMaterialGoo();
    }
}
