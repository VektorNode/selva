using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;

namespace Selva.Grasshopper.Features.ComputeIO.Components;

public class GH_Environement : GH_Component
{

	public override Guid ComponentGuid
	{
		get { return new Guid("58782D53-DA8B-4EFE-8577-B3FA22DA9E0F"); }
	}

	protected override Bitmap Icon => null;

	public GH_Environement()
		: base("GH_Environement", "Nickname",
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

