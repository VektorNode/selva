using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;
using Selva.Slva;

namespace Selva.GH.Features.Display.Components;

public class GH_ThreeMaterial : SelvaZuiComponent
{
    // Index = the Finish input's value, so append only: a saved definition holds the number.
    private static readonly (string label, string wire)[] Finishes =
    {
        ("None", null),
        ("Brushed", "brushed"),
        ("Rolled", "rolled")
    };

    public GH_ThreeMaterial()
        : base("Three Material", "TM",
            "Creates a ThreeMaterial object for web display",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("8313D290-839F-489C-A86D-DD2A2ED3237B");

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override IReadOnlyCollection<string> PrimaryInputs =>
        new[] { "Color", "Metalness", "Roughness", "Opacity", "Transparent", "Texture", "Base" };

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        // No persistent defaults on 0-4: a default would count as wired and beat the base.
        pManager.AddColourParameter("Color", "C", "Material color. Leave empty for the base's, or white.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Metalness", "M",
            "Metalness (0.0 - 1.0). Leave empty for the base's, or 0.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Roughness", "R",
            "Roughness (0.0 - 1.0). Leave empty for the base's, or 0.5.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Opacity", "O", "Opacity (0.0 - 1.0). Leave empty for the base's, or 1.",
            GH_ParamAccess.item);
        pManager.AddBooleanParameter("Transparent", "T",
            "Is material transparent? Leave empty for the base's, or false.", GH_ParamAccess.item);
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
            + "Leave empty for the base's, or none.",
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
            + "image file path.",
            GH_ParamAccess.item);
        pManager.AddGenericParameter("Normal Map", "NM",
            "Optional tangent-space normal texture: a bitmap, an image URL, or an image file path.",
            GH_ParamAccess.item);
        pManager.AddParameter(new Param_ThreeMaterial("Base", "B",
            "A material to start from, such as a Material Preset. Every wired input overrides its value.",
            "Selva", "Display", GH_ParamAccess.item));
        pManager.AddIntegerParameter("Mapping", "MP",
            "Where texture coordinates come from (right-click for the list). Surface: Rhino's, as authored. "
            + "Part: along each part's grain, in mm. World: box projection in mm. "
            + "Authored: the input mesh's own, in model units (e.g. flat-pattern positions); Part when it has none. "
            + "Leave empty for the base's, else Part unless a texture has no Texture Size.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Texture Size", "TS",
            "Millimetres of the real part one repeat of the textures covers, across the texture's width; "
            + "its height follows the image's aspect. Needs Part, World or Authored mapping. "
            + "Leave empty to stretch textures once over the texture coordinates.",
            GH_ParamAccess.item);
        pManager.AddIntegerParameter("Finish", "F",
            "Procedural streaks along the grain, no texture needed (right-click for the list): None, "
            + "Brushed (fine fibres) or Rolled (faint rolling lines).",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Transmission", "TR",
            "Light passing through (0.0 - 1.0), for glass. Unlike Opacity it keeps the reflections.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("IOR", "IOR", "Index of refraction (1.0 - 2.333); glass is about 1.52.",
            GH_ParamAccess.item);

        for (var i = 0; i < pManager.ParamCount; i++)
        {
            pManager[i].Optional = true;
        }

        var mapping = (Param_Integer)pManager[14];
        foreach (UvMapping value in Enum.GetValues(typeof(UvMapping)))
        {
            mapping.AddNamedValue(value.ToString(), (int)value);
        }

        var finish = (Param_Integer)pManager[16];
        for (var i = 0; i < Finishes.Length; i++)
        {
            finish.AddNamedValue(Finishes[i].label, i);
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
        ThreeMaterialGoo baseGoo = null;
        GetInput(DA, "Base", ref baseGoo);
        var material = baseGoo?.Value?.Clone() ?? ThreeMaterial.Default();

        if (TryGet(DA, "Color", out Color color)) material.Color = color;
        if (TryGet(DA, "Metalness", out double metalness)) material.Metalness = metalness;
        if (TryGet(DA, "Roughness", out double roughness)) material.Roughness = roughness;
        if (TryGet(DA, "Opacity", out double opacity)) material.Opacity = opacity;
        if (TryGet(DA, "Transparent", out bool transparent)) material.Transparent = transparent;
        if (TryGet(DA, "Texture", out IGH_Goo map)) material.Map = TextureInput.Resolve(map, this);
        if (TryGet(DA, "Reflection", out double reflection)) material.EnvMapIntensity = reflection;
        if (TryGet(DA, "Clearcoat", out double clearcoat)) material.Clearcoat = clearcoat;
        if (TryGet(DA, "Clearcoat Roughness", out double clearcoatRoughness)) material.ClearcoatRoughness = clearcoatRoughness;
        if (TryGet(DA, "Anisotropy", out double anisotropy)) material.Anisotropy = anisotropy;
        if (TryGet(DA, "Anisotropy Rotation", out double rotation)) material.AnisotropyRotation = rotation;
        if (TryGet(DA, "Roughness Map", out IGH_Goo roughnessMap)) material.RoughnessMap = TextureInput.Resolve(roughnessMap, this);
        if (TryGet(DA, "Normal Map", out IGH_Goo normalMap)) material.NormalMap = TextureInput.Resolve(normalMap, this);
        if (TryGet(DA, "Transmission", out double transmission)) material.Transmission = transmission;
        if (TryGet(DA, "IOR", out double ior)) material.Ior = ior;

        if (TryGet(DA, "Finish", out int finish))
        {
            if (finish >= 0 && finish < Finishes.Length)
            {
                material.Finish = Finishes[finish].wire;
            }
            else
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Finish {finish} does not exist; ignored.");
            }
        }

        if (TryGet(DA, "Texture Size", out double mapSize))
        {
            if (mapSize > 0)
            {
                material.MapSize = mapSize;
            }
            else
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Texture Size must be positive; ignored.");
            }
        }

        var mappingWired = TryGet(DA, "Mapping", out int mappingValue);
        if (mappingWired)
        {
            if (Enum.IsDefined(typeof(UvMapping), mappingValue))
            {
                material.Mapping = (UvMapping)mappingValue;
            }
            else
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Mapping {mappingValue} does not exist; ignored.");
            }
        }

        // Rhino's surface UVs are 0-1 per face, not mm, so a real size can't apply to them.
        if (material.Mapping == UvMapping.Surface && material.MapSize != null)
        {
            if (mappingWired)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                    "Texture Size needs Part, World or Authored mapping; ignored for Surface.");
                material.MapSize = null;
            }
            else
            {
                material.Mapping = UvMapping.Part;
            }
        }

        DA.SetData(0, new ThreeMaterialGoo(material));
    }

    // False when unwired, so the base's value (or the wire's omission) stands.
    private bool TryGet<T>(IGH_DataAccess DA, string name, out T value)
    {
        value = default;
        return GetInput(DA, name, ref value);
    }
}
