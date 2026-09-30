using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.Components;

public class GH_ThreeMaterial : GH_Component
{
    public GH_ThreeMaterial()
        : base("Three Material", "TM",
            "Creates a ThreeMaterial object for web display",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("80CD38E5-BC9E-47E4-88EE-8F35B7E109CC");

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
        pManager.AddNumberParameter("Reflection", "RF",
            "Environment reflection strength (1.0 = full). Overrides the viewer look's value for this "
            + "material, so e.g. sheet metal at 1.0 stays reflective in every look. Leave empty to follow the look.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Clearcoat", "CC",
            "Clear lacquer layer on top of the material (0.0 - 1.0): 0 for bare metal, higher for "
            + "coil-coated or lacquered finishes. Leave empty for the default: a thin satin coat on metals, none otherwise.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Clearcoat Roughness", "CR",
            "Roughness of the clearcoat layer (0.0 - 1.0).", GH_ParamAccess.item);
        pManager.AddNumberParameter("Anisotropy", "A",
            "Stretches highlights along the grain (0.0 - 1.0), as on brushed or rolled sheet. The grain "
            + "runs along the mesh's texture U direction; meshes without texture coordinates ignore it.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Anisotropy Rotation", "AR",
            "Grain direction in radians, counter-clockwise from the texture U direction.",
            GH_ParamAccess.item);
        pManager.AddGenericParameter("Roughness Map", "RM",
            "Optional roughness texture (green channel scales Roughness): a bitmap, an image URL, or an "
            + "image file path. A faint brushed or rolled pattern breaks up a flat CG look.",
            GH_ParamAccess.item);
        pManager.AddGenericParameter("Normal Map", "NM",
            "Optional tangent-space normal texture: a bitmap, an image URL, or an image file path.",
            GH_ParamAccess.item);

        for (var i = 5; i <= 12; i++)
        {
            pManager[i].Optional = true;
        }
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
        IGH_Goo roughnessMapGoo = null;
        IGH_Goo normalMapGoo = null;

        DA.GetData(0, ref color);
        DA.GetData(1, ref metalness);
        DA.GetData(2, ref roughness);
        DA.GetData(3, ref opacity);
        DA.GetData(4, ref transparent);
        DA.GetData(5, ref textureGoo);
        DA.GetData(11, ref roughnessMapGoo);
        DA.GetData(12, ref normalMapGoo);

        var material = new ThreeMaterial
        {
            Color = color,
            Metalness = metalness,
            Roughness = roughness,
            Opacity = opacity,
            Transparent = transparent,
            Map = TextureInput.Resolve(textureGoo, this),
            EnvMapIntensity = GetOptionalNumber(DA, 6),
            Clearcoat = GetOptionalNumber(DA, 7),
            ClearcoatRoughness = GetOptionalNumber(DA, 8),
            Anisotropy = GetOptionalNumber(DA, 9),
            AnisotropyRotation = GetOptionalNumber(DA, 10),
            RoughnessMap = TextureInput.Resolve(roughnessMapGoo, this),
            NormalMap = TextureInput.Resolve(normalMapGoo, this)
        };

        DA.SetData(0, new ThreeMaterialGoo(material));
    }

    // Unwired stays null, so the wire omits the field and the viewer keeps its own default.
    private static double? GetOptionalNumber(IGH_DataAccess DA, int index)
    {
        var value = 0.0;
        return DA.GetData(index, ref value) ? value : (double?)null;
    }
}
