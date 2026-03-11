using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

/// <summary>
///   Dedicated Grasshopper parameter for <see cref="ThreeMaterialGoo" />.
///   Provides proper type safety, type-name display, and wire compatibility
///   when connecting the T-Material output to other components.
/// </summary>
public class Param_ThreeMaterial : GH_Param<ThreeMaterialGoo>
{
	public Param_ThreeMaterial()
		: base(
			"Param Material", "PM",
			"A Three.js-compatible material (color, metalness, roughness, opacity)",
			"Selva", "Display",
			GH_ParamAccess.item)
	{
	}

	protected override Bitmap Icon => Resources.ThreeMaterial;

	public Param_ThreeMaterial(GH_InstanceDescription tag) : base(tag)
	{
	}

	public override GH_Exposure Exposure => GH_Exposure.tertiary;

	public Param_ThreeMaterial(
		string name, string nickname, string description,
		string category, string subcategory,
		GH_ParamAccess access)
		: base(name, nickname, description, category, subcategory, access)
	{
	}

	public override Guid ComponentGuid => new("A1C3E5F7-B2D4-4A6C-8E0F-1234567890AB");

	protected override ThreeMaterialGoo InstantiateT() => new();
}
