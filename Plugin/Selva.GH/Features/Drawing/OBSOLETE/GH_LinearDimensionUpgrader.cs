using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_LinearDimension_UntilV0_23_0 (90160C4E) to GH_LinearDimension (1F0FE0F9), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_LinearDimensionUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("90160C4E-C8C8-4777-BD42-53347E115120");
    public override Guid UpgradeTo => new Guid("1F0FE0F9-C2A9-4BED-AD91-7A16E9F63364");
}
