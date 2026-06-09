using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_BlockToFile_UntilV0_11_0 (BC984091) to GH_BlockToFile (4D92D5D2).
///     Added: Metadata input (index 4) at the end. Previous inputs map 1:1; the new input stays empty.
/// </summary>
public class GH_BlockToFileUpgrader_To_0_11_1 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 6, 9);
    public Guid UpgradeFrom => new Guid("BC984091-9444-4757-B781-486DDC31BDC4");
    public Guid UpgradeTo => new Guid("4D92D5D2-37D3-4046-A513-CED165939336");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not IGH_Component oldComponent)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Block
            .MapInput(1, 1) // File Name
            .MapInput(2, 2) // Format
            .MapInput(3, 3) // Sub Folder
            // Input 4 (Metadata) is new — stays empty
            .MapOutput(0, 0) // File
            .Execute();

        return newComponent;
    }
}
