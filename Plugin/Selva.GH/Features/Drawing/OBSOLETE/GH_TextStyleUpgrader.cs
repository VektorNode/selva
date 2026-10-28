using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_TextStyle_UntilV0_23_0 (D37B61DB) to GH_TextStyle (6D5CCE51), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_TextStyleUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("D37B61DB-4FC4-4F01-9A76-95DA5D719EEA");
    public override Guid UpgradeTo => new Guid("6D5CCE51-0B0D-4936-B076-E7D0DD1B820D");
}
