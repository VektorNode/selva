using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_FileFromPath_UntilV0_11_0 (F2B8D4A6) to GH_FileFromPath (A66F2DA2).
///     Added: Metadata input (index 3) at the end. Previous inputs map 1:1; the new input stays empty.
/// </summary>
public class GH_FileFromPathUpgrader_To_0_11_1 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 6, 9);
    public Guid UpgradeFrom => new Guid("F2B8D4A6-C3E7-4B1F-9D5A-8E2C6F4A1B3D");
    public Guid UpgradeTo => new Guid("A66F2DA2-800B-460D-9996-7C13BDEE4553");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not IGH_Component oldComponent)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Path
            .MapInput(1, 1) // Name
            .MapInput(2, 2) // Sub Folder
            // Input 3 (Metadata) is new — stays empty
            .MapOutput(0, 0) // File
            .Execute();

        return newComponent;
    }
}
