using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

public class GH_MaterialPreset : GH_Component
{
    public GH_MaterialPreset()
        : base("Material Preset", "MPre",
            "A ready material for a real finish: measured base colour, roughness, grain and mapping. "
            + "Wire it into Display, or into Three Material's Base to override parts of it.",
            "Selva", "Display")
    {
    }

    public override Guid ComponentGuid => new Guid("15736FB4-A5A1-48AD-B0EE-A9193DB08DA8");

    protected override Bitmap Icon => Resources.ThreeMaterial;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddIntegerParameter("Preset", "P", "The finish (right-click for the list).",
            GH_ParamAccess.item, 1);

        var preset = (Param_Integer)pManager[0];
        for (var i = 1; i < MaterialPresets.All.Length; i++)
        {
            preset.AddNamedValue(MaterialPresets.All[i].Name, i);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_ThreeMaterial("Material", "M",
            "The material, for a Display's Material input or Three Material's Base", "Selva", "Display",
            GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var value = 0;
        DA.GetData(0, ref value);
        var preset = MaterialPresets.Get(value);
        if (preset == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Preset {value} does not exist.");
            return;
        }

        Message = preset.Name;
        DA.SetData(0, new ThreeMaterialGoo(preset.ToMaterial()));
    }
}
