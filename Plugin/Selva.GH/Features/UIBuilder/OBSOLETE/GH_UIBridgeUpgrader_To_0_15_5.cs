using System;
using Grasshopper.Kernel;
using Selva.GH.Features.UIBuilder.Components;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.UIBuilder.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_UIBridge_UntilV0_15_4 (D4E5F6A7) to GH_UIBuilderComponent (593BC967).
///     Added: URL output (index 1) at the end. Enable input and Schema output map 1:1; the
///     embedded schema/values are carried over so the linked UI survives the swap.
/// </summary>
public class GH_UIBridgeUpgrader_To_0_15_5 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 7, 22);
    public Guid UpgradeFrom => new Guid("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");
    public Guid UpgradeTo => new Guid("593BC967-797A-4B1A-9B76-C2133F6B08E2");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not OBSOLETE_UIBridge_UntilV0_15_4 oldComponent)
        {
            return null;
        }

        // The swap adds the new component to the document before its sources are migrated, so without
        // this the replacement would look like a fresh drop and auto-wire a duplicate Enable toggle.
        IGH_Component newComponent;
        using (GH_UIBuilderComponent.SuppressAutoWire())
        {
            var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
            newComponent = helper
                .MapInput(0, 0) // Enable
                .MapOutput(0, 0) // Schema
                // Output 1 (URL) is new — nothing to migrate
                .Execute();
        }

        if (newComponent is GH_UIBuilderComponent fresh)
        {
            fresh.TransferStateFrom(oldComponent);
        }

        return newComponent;
    }
}
