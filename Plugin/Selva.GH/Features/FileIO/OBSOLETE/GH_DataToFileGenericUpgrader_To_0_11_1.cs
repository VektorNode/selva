using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_DataToFileGeneric_UntilV0_11_0 (F9B3F862) to GH_DataToFileGeneric (4A845B41).
///     Added: Metadata input (index 5) at the end. Previous inputs map 1:1; the new input stays empty.
/// </summary>
public class GH_DataToFileGenericUpgrader_To_0_11_1 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 6, 9);
    public Guid UpgradeFrom => new Guid("F9B3F862-611E-4E67-9DE4-67129CC0EF24");
    public Guid UpgradeTo => new Guid("4A845B41-30E7-4DC7-BD47-0AC4C44E4F46");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not IGH_Component oldComponent)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Data
            .MapInput(1, 1) // Name
            .MapInput(2, 2) // Extension
            .MapInput(3, 3) // Is Base64
            .MapInput(4, 4) // Sub Folder
            // Input 5 (Metadata) is new — stays empty
            .MapOutput(0, 0) // File
            .Execute();

        return newComponent;
    }
}
