using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_BlockToFile_UntilV0_6_2 (06308887) to GH_BlockToFile (BC984091).
///     Added: Format input (index 2) and Sub Folder input (index 3). Previous inputs map 1:1.
/// </summary>
public class GH_BlockToFileUpgrader : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 3, 10);
    public Guid UpgradeFrom => new Guid("06308887-AADB-40EE-A6A8-9CC8E05900EB");
    public Guid UpgradeTo => new Guid("BC984091-9444-4757-B781-486DDC31BDC4");

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
            .MapOutput(0, 0) // File
            .Execute();

        return newComponent;
    }
}
