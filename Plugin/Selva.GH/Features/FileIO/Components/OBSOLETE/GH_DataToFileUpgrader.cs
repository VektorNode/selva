using System;
using Grasshopper.Kernel;
using Selva.GH.Utilities;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.Components;

/// <summary>
///   Upgrades OBSOLETE_DataToFile_UntilV0_6_2 (A51C8F6A) to GH_DataToFile (8D0ECB14).
///   Added: Sub Folder input (index 5). All previous inputs map 1:1.
/// </summary>
public class GH_DataToFileUpgrader : IGH_UpgradeObject
{
	public DateTime Version => new DateTime(2026, 3, 10);
	public Guid UpgradeFrom => new Guid("A51C8F6A-D422-4387-8170-F9F34D8E5351");
	public Guid UpgradeTo => new Guid("8D0ECB14-7318-4400-8AA2-588E6424ACC4");

	public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
	{
		var oldComponent = target as IGH_Component;
		if (oldComponent == null) return null;

		var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
		var newComponent = helper
			.MapInput(0, 0)  // Geometry
			.MapInput(1, 1)  // Layer Names
			.MapInput(2, 2)  // Layer Colors
			.MapInput(3, 3)  // File Names
			.MapInput(4, 4)  // File Ending
			                 // Input 5 (Sub Folder) is new — left empty/default
			.MapOutput(0, 0) // File
			.Execute();

		return newComponent;
	}
}
