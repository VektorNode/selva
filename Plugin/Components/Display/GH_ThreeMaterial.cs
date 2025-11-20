using System;
using System.Drawing;
using Compuceraptor.Components.Display;
using GH_IO.Serialization;
using Grasshopper.Kernel;

namespace Compuceraptor.Components;

public class GH_ThreeMaterial : GH_Component
{

    public GH_ThreeMaterial()
      : base("Three Material", "TM",
          "Creates a ThreeMaterial object for use in ThreeDisplay",
          "Compuceraptor", "Display")
    {
    }

    public override Guid ComponentGuid
    {
        get { return new Guid("D7A8738A-85AA-4707-A486-DCB84AA21C6B"); }
    }

    protected override Bitmap Icon => null;

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
        pManager.AddGenericParameter("Material", "M", "ThreeMaterial object", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Color color = Color.White;
        double metalness = 0.0;
        double roughness = 0.5;
        double opacity = 1.0;
        bool transparent = false;

        DA.GetData(0, ref color);
        DA.GetData(1, ref metalness);
        DA.GetData(2, ref roughness);
        DA.GetData(3, ref opacity);
        DA.GetData(4, ref transparent);

        var material = new ThreeMaterial
        {
            color = color,
            metalness = metalness,
            roughness = roughness,
            opacity = opacity,
            transparent = transparent
        };
        
        DA.SetData(0, new ThreeMaterialGoo(material));
    }
}