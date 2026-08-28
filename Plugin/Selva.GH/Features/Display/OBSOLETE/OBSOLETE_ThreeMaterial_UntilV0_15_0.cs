using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Obsolete Three Material component (until v0.15.0). Replaced by the version with an
///     optional Texture input (bitmap / URL / file path).
/// </summary>
public class OBSOLETE_ThreeMaterial_UntilV0_15_0 : GH_Component
{
    public OBSOLETE_ThreeMaterial_UntilV0_15_0()
        : base("Three Material", "TM",
            "Creates a ThreeMaterial object for web display",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("D7A8738A-85AA-4707-A486-DCB84AA21C6B");

    public override GH_Exposure Exposure => GH_Exposure.hidden;

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Color", "C", "Material color", GH_ParamAccess.item, Color.White);
        pManager.AddNumberParameter("Metalness", "M", "Metalness (0.0 - 1.0)", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Roughness", "R", "Roughness (0.0 - 1.0)", GH_ParamAccess.item, 0.5);
        pManager.AddNumberParameter("Opacity", "O", "Opacity (0.0 - 1.0)", GH_ParamAccess.item, 1.0);
        pManager.AddBooleanParameter("Transparent", "T", "Is material transparent?", GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        // Pinned to the name this released component shipped with; the param's
        // own default name has since changed.
        pManager.AddParameter(new Param_ThreeMaterial("Material", "M",
            "A Three.js-compatible material", "Selva", "Display", GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var color = Color.White;
        var metalness = 0.0;
        var roughness = 0.5;
        var opacity = 1.0;
        var transparent = false;

        DA.GetData(0, ref color);
        DA.GetData(1, ref metalness);
        DA.GetData(2, ref roughness);
        DA.GetData(3, ref opacity);
        DA.GetData(4, ref transparent);

        var material = new ThreeMaterial
        {
            Color = color,
            Metalness = metalness,
            Roughness = roughness,
            Opacity = opacity,
            Transparent = transparent
        };

        DA.SetData(0, new ThreeMaterialGoo(material));
    }
}
