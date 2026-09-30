using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Obsolete Three Material component (v0.16.0 until v0.20.3). Replaced by the version with
///     reflection, clearcoat, anisotropy, roughness map and normal map inputs.
/// </summary>
public class OBSOLETE_ThreeMaterial_UntilV0_20_3 : GH_Component
{
    public OBSOLETE_ThreeMaterial_UntilV0_20_3()
        : base("Three Material", "TM",
            "Creates a ThreeMaterial object for web display",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("B7665E1A-C4CC-49D6-8EDB-4AAEF045D9A8");

    public override GH_Exposure Exposure => GH_Exposure.hidden;

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Color", "C", "Material color", GH_ParamAccess.item, Color.White);
        pManager.AddNumberParameter("Metalness", "M", "Metalness (0.0 - 1.0)", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Roughness", "R", "Roughness (0.0 - 1.0)", GH_ParamAccess.item, 0.5);
        pManager.AddNumberParameter("Opacity", "O", "Opacity (0.0 - 1.0)", GH_ParamAccess.item, 1.0);
        pManager.AddBooleanParameter("Transparent", "T", "Is material transparent?", GH_ParamAccess.item, false);
        pManager.AddGenericParameter("Texture", "TX",
            "Optional texture for the material's color map: a bitmap, an image URL, or an image file path. "
            + "Meshes displayed with a textured material carry their texture coordinates to the web viewer.",
            GH_ParamAccess.item);

        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_ThreeMaterial("Material", "M",
            "The material, for a Display component's Material input", "Selva", "Display",
            GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var color = Color.White;
        var metalness = 0.0;
        var roughness = 0.5;
        var opacity = 1.0;
        var transparent = false;
        IGH_Goo textureGoo = null;

        DA.GetData(0, ref color);
        DA.GetData(1, ref metalness);
        DA.GetData(2, ref roughness);
        DA.GetData(3, ref opacity);
        DA.GetData(4, ref transparent);
        DA.GetData(5, ref textureGoo);

        var material = new ThreeMaterial
        {
            Color = color,
            Metalness = metalness,
            Roughness = roughness,
            Opacity = opacity,
            Transparent = transparent,
            Map = TextureInput.Resolve(textureGoo, this)
        };

        DA.SetData(0, new ThreeMaterialGoo(material));
    }
}
