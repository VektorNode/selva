using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;
using Selva.Slva;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_ThreeMaterial_UntilV0_21_0 (80CD38E5) to GH_ThreeMaterial (31100A9A), which
///     appends Base, Mapping, Texture Size, Finish, Transmission and IOR. All optional and left empty,
///     so the material is unchanged.
/// </summary>
public class GH_ThreeMaterialUpgrader_To_0_22 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 10, 1);
    public Guid UpgradeFrom => new Guid("80CD38E5-BC9E-47E4-88EE-8F35B7E109CC");
    public Guid UpgradeTo => new Guid("31100A9A-AA13-43EF-9C2C-8F3C56BC6D68");

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
            .MapInput(6, 6) // Reflection
            .MapInput(7, 7) // Clearcoat
            .MapInput(8, 8) // Clearcoat Roughness
            .MapInput(9, 9) // Anisotropy
            .MapInput(10, 10) // Anisotropy Rotation
            .MapInput(11, 11) // Roughness Map
            .MapInput(12, 12) // Normal Map
            // Inputs 13-18 are new and stay empty
            .MapOutput(0, 0) // Material
            .Execute();
    }
}

/// <summary>
///     Upgrades OBSOLETE_ThreeMaterial_UntilV0_20_3 (B7665E1A) to the v0.21 Three Material (80CD38E5),
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
