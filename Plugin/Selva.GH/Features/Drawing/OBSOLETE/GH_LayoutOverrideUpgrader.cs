using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_LayoutOverride_UntilV0_23_0 (3F5F0E10) to GH_LayoutOverride (6B443A70), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_LayoutOverrideUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("3F5F0E10-2A21-4F0E-9F25-7B0F2C7C5E91");
    public override Guid UpgradeTo => new Guid("6B443A70-1C56-464B-BBAE-E0AE2E420789");
}
