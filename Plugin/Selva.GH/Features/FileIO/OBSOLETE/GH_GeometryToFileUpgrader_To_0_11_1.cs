using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_GeometryToFile_UntilV0_11_0 (8D0ECB14) to GH_GeometryToFile (4B2646E6).
///     Added: Metadata input (index 6) at the end. Previous inputs map 1:1; the new input stays empty.
/// </summary>
public class GH_GeometryToFileUpgrader_To_0_11_1 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 6, 9);
    public Guid UpgradeFrom => new Guid("8D0ECB14-7318-4400-8AA2-588E6424ACC4");
    public Guid UpgradeTo => new Guid("4B2646E6-A8B0-48B6-A566-FE5EC2376C82");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not IGH_Component oldComponent)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Geometry
            .MapInput(1, 1) // Layer Names
            .MapInput(2, 2) // Layer Colors
            .MapInput(3, 3) // File Names
            .MapInput(4, 4) // File Ending
            .MapInput(5, 5) // Sub Folder
            // Input 6 (Metadata) is new — stays empty
            .MapOutput(0, 0) // File
            .Execute();

        return newComponent;
    }
}
