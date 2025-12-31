using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino;
using Rhino.Geometry;
using Selva.Grasshopper.Properties;

namespace Selva.Grasshopper.Features.ComputeIO.Components;

public class GH_Environement : GH_Component
{
	public override Guid ComponentGuid
	{
		get { return new Guid("58782D53-DA8B-4EFE-8577-B3FA22DA9E0F"); }
	}

	protected override Bitmap Icon => Resources.Environment;

	public GH_Environement()
		: base("Environment", "Env",
			"Get information about the current running environment (Compute or Desktop)",
			"Selva", "Utilities")
	{
	}

	public override GH_Exposure Exposure => GH_Exposure.primary;

	protected override void RegisterInputParams(GH_InputParamManager pManager)
	{
	}

	protected override void RegisterOutputParams(GH_OutputParamManager pManager)
	{
		pManager.AddBooleanParameter("Is Compute", "IC", "Is running in a compute environment", GH_ParamAccess.item);
	}

	protected override void SolveInstance(IGH_DataAccess DA)
	{
		bool isCompute = false;

		var activeDoc = RhinoDoc.ActiveDoc;
		if (activeDoc != null)
		{
			if (activeDoc.IsHeadless) isCompute = true;
		}
		else
		{
			isCompute = true;
		}

		DA.SetData(0, isCompute);
	}
}
