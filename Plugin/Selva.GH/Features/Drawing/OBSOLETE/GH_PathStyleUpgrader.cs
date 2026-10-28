using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_PathStyle_UntilV0_23_0 (3F5C21A9) to GH_PathStyle (4CEFA814), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_PathStyleUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("3F5C21A9-7D64-4E18-9B02-6C1A4D8E5F37");
    public override Guid UpgradeTo => new Guid("4CEFA814-76BC-4BC5-AF7D-0BA6F3B48C4E");
}

/// <summary>
///     Upgrades OBSOLETE_PathStyle_UntilV0_16_0 (20587568) to the v0.16 Path Style (3F5C21A9), which
///     appends the Pattern Spacing and Pattern Line Width inputs. Both are appended after the
///     existing inputs, so every prior index maps straight through and the two new ones are
///     left empty (0 = "derive from Pattern Scale", i.e. the old behaviour).
/// </summary>
public class GH_PathStyleUpgrader_To_0_16 : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 7, 27);
    public Guid UpgradeFrom => new Guid("20587568-1E6E-481D-9ED8-AC136477E323");
    public Guid UpgradeTo => new Guid("3F5C21A9-7D64-4E18-9B02-6C1A4D8E5F37");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        var oldComponent = target as IGH_Component;
        if (oldComponent == null)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapInput(0, 0)   // Stroke Color
            .MapInput(1, 1)   // Stroke Width
            .MapInput(2, 2)   // Stroke Opacity
            .MapInput(3, 3)   // Fill Color
            .MapInput(4, 4)   // Fill
            .MapInput(5, 5)   // Fill Opacity
            .MapInput(6, 6)   // Line Cap
            .MapInput(7, 7)   // Line Join
            .MapInput(8, 8)   // Dash Pattern
            .MapInput(9, 9)   // Fill Rule
            .MapInput(10, 10) // Hatch Pattern
            .MapInput(11, 11) // Pattern Scale
            .MapInput(12, 12) // Pattern Angle
            // Inputs 13 (Pattern Spacing) and 14 (Pattern Line Width) are new — left empty,
            // which resolves to the pre-0.16 behaviour.
            .MapOutput(0, 0)  // Style
            .Execute();

        return newComponent;
    }
}
