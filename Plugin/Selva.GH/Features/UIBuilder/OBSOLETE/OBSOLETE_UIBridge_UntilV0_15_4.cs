using System;
using Grasshopper.Kernel;
using Selva.GH.Features.UIBuilder.Components;

namespace Selva.GH.Features.UIBuilder.OBSOLETE;

/// <summary>
///     Obsolete UI Bridge component (until v0.15.4). Replaced by the version with a URL output.
///     Inherits the live implementation; only the component identity and the old single-output
///     signature are pinned so existing files keep loading and solving unchanged.
/// </summary>
public class OBSOLETE_UIBridge_UntilV0_15_4 : GH_UIBuilderComponent
{
    public override Guid ComponentGuid => new Guid("D4E5F6A7-B8C9-4D5E-0F1A-2B3C4D5E6F7A");

    public override GH_Exposure Exposure => GH_Exposure.hidden;

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Schema", "Schema", "Current UI schema", GH_ParamAccess.item);
    }
}
