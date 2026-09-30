using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;
using Selva.Slva;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_ThreeMaterial_UntilV0_20_3 (B7665E1A) to GH_ThreeMaterial (80CD38E5),
///     which appends Reflection, Clearcoat, Clearcoat Roughness, Anisotropy, Anisotropy Rotation,
///     Roughness Map and Normal Map. All optional and left empty, so the material is unchanged.
/// </summary>
public class GH_ThreeMaterialUpgrader_To_0_21 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 9, 30);
    public Guid UpgradeFrom => new Guid("B7665E1A-C4CC-49D6-8EDB-4AAEF045D9A8");
    public Guid UpgradeTo => new Guid("80CD38E5-BC9E-47E4-88EE-8F35B7E109CC");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        var oldComponent = target as IGH_Component;
        if (oldComponent == null)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        return helper
            .MapInput(0, 0) // Color
            .MapInput(1, 1) // Metalness
            .MapInput(2, 2) // Roughness
            .MapInput(3, 3) // Opacity
            .MapInput(4, 4) // Transparent
            .MapInput(5, 5) // Texture
            // Inputs 6-12 are new and stay empty
            .MapOutput(0, 0) // Material
            .Execute();
    }
}

/// <summary>
///     Upgrades OBSOLETE_ThreeMaterial_UntilV0_15_0 (D7A8738A) to the v0.16 Three Material
///     (B7665E1A), which adds the optional Texture input.
/// </summary>
public class GH_ThreeMaterialUpgrader_To_0_16 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 7, 2);
    public Guid UpgradeFrom => new Guid("D7A8738A-85AA-4707-A486-DCB84AA21C6B");
    public Guid UpgradeTo => new Guid("B7665E1A-C4CC-49D6-8EDB-4AAEF045D9A8");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        var oldComponent = target as IGH_Component;
        if (oldComponent == null)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0) // Color
            .MapInput(1, 1) // Metalness
            .MapInput(2, 2) // Roughness
            .MapInput(3, 3) // Opacity
            .MapInput(4, 4) // Transparent
            // Input 5 (Texture) is new — will be empty
            .MapOutput(0, 0) // T-Material
            .Execute();

        return newComponent;
    }
}
