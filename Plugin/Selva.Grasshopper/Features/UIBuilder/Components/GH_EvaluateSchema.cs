using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;

namespace Selva.Grasshopper.Features.UIBuilder.Components;

public class GH_EvaluateSchema : GH_Component
{

  public override Guid ComponentGuid
  {
    get { return new Guid("E7611CB2-9BAE-4A88-B47B-A94135394FA3"); }
  }

  protected override Bitmap Icon => null;

  public GH_EvaluateSchema()
    : base("GH_EvaluateSchema", "Nickname",
      "Description",
      "Selva", "Subcategory")
  {
  }


  protected override void RegisterInputParams(GH_InputParamManager pManager)
  {
  }


  protected override void RegisterOutputParams(GH_OutputParamManager pManager)
  {
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
  }

}

