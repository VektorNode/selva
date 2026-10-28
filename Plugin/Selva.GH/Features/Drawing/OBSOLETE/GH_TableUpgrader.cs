using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_Table_UntilV0_23_0 (2B7C8D3E) to GH_Table (2CF47AC1), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_TableUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("2B7C8D3E-4F5A-4B6C-8D9E-1F2A3B4C5D62");
    public override Guid UpgradeTo => new Guid("2CF47AC1-C52E-4E86-8495-30B86969232B");
}
