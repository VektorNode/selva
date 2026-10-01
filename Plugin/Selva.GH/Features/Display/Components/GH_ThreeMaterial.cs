using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
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

    public override Guid ComponentGuid => new Guid("31100A9A-AA13-43EF-9C2C-8F3C56BC6D68");

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // No persistent defaults on 0-4: a default would count as wired and beat the preset.
        pManager.AddColourParameter("Color", "C", "Material color. Leave empty for the preset's, or white.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Metalness", "M",
            "Metalness (0.0 - 1.0). Leave empty for the preset's, or 0.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Roughness", "R",
            "Roughness (0.0 - 1.0). Leave empty for the preset's, or 0.5.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Opacity", "O", "Opacity (0.0 - 1.0). Leave empty for 1.",
            GH_ParamAccess.item);
        pManager.AddBooleanParameter("Transparent", "T", "Is material transparent? Leave empty for false.",
            GH_ParamAccess.item);
        pManager.AddGenericParameter("Texture", "TX",
            "Optional texture for the material's color map: a bitmap, an image URL, or an image file path. "
            + "Meshes displayed with a textured material carry their texture coordinates to the web viewer.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Reflection", "RF",
            "Environment reflection strength (1.0 = full). Overrides the viewer look's value for this "
            + "material. Leave empty to follow the look; metals then keep their reflection in every look.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Clearcoat", "CC",
            "Clear lacquer layer on top of the material (0.0 - 1.0), for lacquered finishes. "
            + "Leave empty for none.",
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
        pManager.AddIntegerParameter("Preset", "P",
            "Starting values for a real material (right-click for the list). Every wired input overrides "
            + "its preset value.",
            GH_ParamAccess.item);
        pManager.AddIntegerParameter("Mapping", "MP",
            "Where texture coordinates come from (right-click for the list). Surface: Rhino's, as authored. "
            + "Part: along each part's grain, in mm. World: box projection in mm. "
            + "Leave empty for the preset's, else Part unless a texture has no Texture Size.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Texture Size", "TS",
            "Millimetres of the real part one repeat of the textures covers, across the texture's width; "
            + "its height follows the image's aspect. Needs Part or World mapping. "
            + "Leave empty to stretch textures once over the texture coordinates.",
            GH_ParamAccess.item);

        for (var i = 0; i < pManager.ParamCount; i++)
        {
            pManager[i].Optional = true;
        }

        var preset = (Param_Integer)pManager[13];
        preset.AddNamedValue("None", 0);
        for (var i = 1; i < MaterialPresets.All.Length; i++)
        {
            preset.AddNamedValue(MaterialPresets.All[i].Name, i);
        }

        var mapping = (Param_Integer)pManager[14];
        foreach (UvMapping value in Enum.GetValues(typeof(UvMapping)))
        {
            mapping.AddNamedValue(value.ToString(), (int)value);
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
        var presetValue = 0;
        DA.GetData(13, ref presetValue);
        var preset = MaterialPresets.Get(presetValue);
        if (presetValue != 0 && preset == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Preset {presetValue} does not exist; using none.");
        }

        var color = preset?.Color ?? Color.White;
        var metalness = preset?.Metalness ?? 0.0;
        var roughness = preset?.Roughness ?? 0.5;
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

        var mapSize = GetOptionalNumber(DA, 15);
        if (mapSize <= 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Texture Size must be positive; ignored.");
            mapSize = null;
        }

        var mappingValue = 0;
        var mappingWired = DA.GetData(14, ref mappingValue);
        var mapping = preset?.Mapping ?? UvMapping.Auto;
        if (mappingWired)
        {
            if (Enum.IsDefined(typeof(UvMapping), mappingValue))
            {
                mapping = (UvMapping)mappingValue;
            }
            else
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Mapping {mappingValue} does not exist; using Auto.");
                mapping = UvMapping.Auto;
            }
        }

        // Rhino's surface UVs are 0-1 per face, not mm, so a real size can't apply to them.
        if (mapping == UvMapping.Surface && mapSize != null)
        {
            if (mappingWired)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                    "Texture Size needs Part or World mapping; ignored for Surface.");
                mapSize = null;
            }
            else
            {
                mapping = UvMapping.Part;
            }
        }

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
            Anisotropy = GetOptionalNumber(DA, 9) ?? preset?.Anisotropy,
            AnisotropyRotation = GetOptionalNumber(DA, 10),
            RoughnessMap = TextureInput.Resolve(roughnessMapGoo, this),
            NormalMap = TextureInput.Resolve(normalMapGoo, this),
            Finish = preset?.Finish,
            Transmission = preset?.Transmission,
            Ior = preset?.Ior,
            Mapping = mapping,
            MapSize = mapSize
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
