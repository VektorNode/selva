using System;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Upgrades OBSOLETE_AngularDimension_UntilV0_23_0 (A90C4D76) to GH_AngularDimension (2D0CD233), which hides
///     rarely used inputs. Every input keeps its index; the unused ones hide.
/// </summary>
public class GH_AngularDimensionUpgrader_To_0_24 : SelvaZuiUpgrader
{
    public override DateTime Version => new DateTime(2026, 10, 28);
    public override Guid UpgradeFrom => new Guid("A90C4D76-9482-4501-A905-F9221656B6C8");
    public override Guid UpgradeTo => new Guid("2D0CD233-7615-4DF5-8057-46DD7FD4ECBE");
}
