using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_DisplayFromFile_UntilV0_18_0 (8B2E5C71) to GH_DisplayFromFile (B9FCCDF3),
///     which drops the Id input now that SLVM v3 carries object identity in the container itself.
/// </summary>
public class GH_DisplayFromFileUpgrader_To_0_18 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 8, 30);
    public Guid UpgradeFrom => new Guid("8B2E5C71-9A34-4F6D-B017-3C4D5E6F7A81");
    public Guid UpgradeTo => new Guid("B9FCCDF3-DBA3-47C0-BEAA-078ABFB92241");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        var oldComponent = target as IGH_Component;
        if (oldComponent == null)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Path
            // Input 1 (Id) is gone — identity now lives in the SLVM v3 container
            .MapOutput(0, 0) // Web Display
            .Execute();

        return newComponent;
    }
}
