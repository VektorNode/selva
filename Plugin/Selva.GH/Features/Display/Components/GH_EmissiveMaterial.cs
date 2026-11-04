using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.UIBuilder.Helpers;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.Components;

public class GH_EmissiveMaterial : GH_Component
{
    private const double DefaultStrength = 4;

    private static readonly Color DefaultColor = Color.FromArgb(255, 232, 196);

    public GH_EmissiveMaterial()
        : base("Emissive Material", "Emit",
            "A material that glows: lamps, screens, lit windows. In the viewer's Night look it also "
            + "lights the scene. Wire it into Display, or give it a Base to make any material glow.",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("7D3C1F52-9A64-4E0B-8C27-5B1E6A0F42D9");

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddColourParameter("Color", "C", "The light's colour.", GH_ParamAccess.item, DefaultColor);
        pManager.AddNumberParameter("Strength", "S",
            "How bright it glows. Around 1 is a lit surface, 4 a lamp. 0 turns it off.",
            GH_ParamAccess.item, DefaultStrength);
        pManager.AddParameter(new Param_ThreeMaterial("Base", "B",
            "The surface when it isn't glowing. Leave empty for a matte surface in the light's colour.",
            "Selva", "Display", GH_ParamAccess.item));
        pManager.AddNumberParameter("Kelvin", "K",
            "Colour temperature of a real source, as on its datasheet: 2700 warm, 4000 neutral, 6500 "
            + "daylight. Replaces Color.",
            GH_ParamAccess.item);
        pManager.AddNumberParameter("Lumens", "lm",
            "Luminous flux of a real source: an 800 lm desk lamp lights a desk as it would in the room. "
            + "Replaces Strength.",
            GH_ParamAccess.item);
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_ThreeMaterial("Material", "M",
            "The material, for a Display component's Material input", "Selva", "Display",
            GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var color = DefaultColor;
        var strength = DefaultStrength;
        ThreeMaterialGoo baseGoo = null;
        DA.GetData(0, ref color);
        DA.GetData(1, ref strength);
        DA.GetData(2, ref baseGoo);

        var kelvin = 0.0;
        if (DA.GetData(3, ref kelvin))
        {
            if (kelvin < Photometry.MinKelvin || kelvin > Photometry.MaxKelvin)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                    $"Kelvin held to {Photometry.MinKelvin:0} - {Photometry.MaxKelvin:0}.");
            }

            color = Photometry.AdaptedLightColor(kelvin);
        }

        double? lumens = null;
        var flux = 0.0;
        if (DA.GetData(4, ref flux))
        {
            lumens = Math.Max(0, flux);
            strength = Photometry.StrengthFromLumens(lumens.Value);
        }

        var material = baseGoo?.Value?.Clone() ?? ThreeMaterial.Default();
        if (baseGoo == null)
        {
            material.Color = color;
        }

        if (strength < 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Strength can't be negative; used 0.");
            strength = 0;
        }

        material.Emissive = strength > 0 ? ColorHex.Of(color) : null;
        material.EmissiveIntensity = strength > 0 ? strength : null;
        material.EmissiveLight = lumens > 0 ? Photometry.SceneLightFromLumens(lumens.Value) : null;
        DA.SetData(0, new ThreeMaterialGoo(material));
    }
}
