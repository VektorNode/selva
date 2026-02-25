using System;
using Grasshopper.Kernel;
using Selva.GH.Utilities;
using SheepMetal.Plugin_Grasshopper.Upgraders;

namespace Selva.GH.Features.Display.Components;

public class GH_WebDisplayUpgrader_To_0_6 : IGH_UpgradeObject
{
	public DateTime Version => new DateTime(2026, 2, 16);
	public Guid UpgradeFrom => new Guid("FCBBE140-D11C-4AA2-97E2-9DA0559CF0DF");
	public Guid UpgradeTo => new Guid("9B5515B2-861A-4840-B884-82B725203ABB");

	public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
	{
		var oldComponent = target as IGH_Component;
		if (oldComponent == null) return null;

		var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
		var newComponent = helper
			.MapInput(0, 0)
			.MapInput(1, 1)
			.MapInput(2, 2)
			.MapInput(3, 3)
			.MapOutput(0, 0) // Web Display
			.Execute();

		return newComponent;
	}
}

public class GH_WebDisplayUpgrader : IGH_UpgradeObject
{
	public DateTime Version => new DateTime(2026, 1, 13);
	public Guid UpgradeFrom => new Guid("3B108239-0103-4D4B-8407-534A78811090");
	public Guid UpgradeTo => new Guid("FCBBE140-D11C-4AA2-97E2-9DA0559CF0DF");

	public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
	{
		var oldComponent = target as IGH_Component;
		if (oldComponent == null) return null;

		var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
		var newComponent = helper
			.MapInput(0, 0) // Geo
			.MapInput(1, 1) // Mesh Name
			.MapInput(2, 3) // T-Material -> T-Material
			.MapInput(3, 4) // Meshing Settings -> Meshing Settings
											// Input 2 (Metadata) is new and will be empty
			.MapOutput(0, 0) // Web Display
			.Execute();

		return newComponent;
	}
}
