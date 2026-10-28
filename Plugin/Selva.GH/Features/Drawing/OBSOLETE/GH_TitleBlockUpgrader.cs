using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_TitleBlock_UntilV0_23_0 (A2501A92) to GH_TitleBlock (B0FA5F7E), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_TitleBlockUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("A2501A92-E5D1-4646-A3D0-4368CE879BFC");
    public override Guid UpgradeTo => new Guid("B0FA5F7E-9B4C-47F1-904D-052FEB7C9098");
}
