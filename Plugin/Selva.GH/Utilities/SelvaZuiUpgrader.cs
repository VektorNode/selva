using System;
using Grasshopper.Kernel;

namespace Selva.GH.Utilities;

/// <summary>
///     Upgrades a fixed-list component to its <see cref="SelvaZuiComponent" /> replacement. Both
///     register the same inputs in the same order, so the old params move across whole (wires,
///     internalised data, flags), and then the unused ones hide.
/// </summary>
public abstract class SelvaZuiUpgrader : IGH_UpgradeObject
{
    public abstract DateTime Version { get; }
    public abstract Guid UpgradeFrom { get; }
    public abstract Guid UpgradeTo { get; }

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        if (target is not IGH_Component oldComponent)
        {
            return null;
        }

        var newComponent = GH_UpgradeUtil.SwapComponents(oldComponent, UpgradeTo, true);
        if (newComponent is SelvaZuiComponent zui)
        {
            zui.HideUnusedInputs();
            zui.Params.OnParametersChanged();
            zui.Attributes.ExpireLayout();
        }

        return newComponent;
    }
}
