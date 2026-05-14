using System;
using Grasshopper.Kernel;
using SheepMetal.PluginGrasshopper.Upgraders;

namespace Selva.GH.Features.FileIO.OBSOLETE;

public class GH_DataToFileGenericUpgrader : IGH_UpgradeObject
{
    public DateTime Version => new DateTime(2026, 3, 12);
    public Guid UpgradeFrom => new Guid("D7A3E1C5-B248-4F9A-8C6D-2E5F1A3B7D9E");
    public Guid UpgradeTo => new Guid("F9B3F862-611E-4E67-9DE4-67129CC0EF24");

    public IGH_DocumentObject Upgrade(IGH_DocumentObject target, GH_Document document)
    {
        var oldComponent = target as IGH_Component;
        if (oldComponent == null)
        {
            return null;
        }

        var helper = new GH_ComponentUpgradeHelper(oldComponent, UpgradeTo);
        var newComponent = helper
            .MapAllInputs() // Data, Name, Extension, Is Base64, Sub Folder
            .MapAllOuputs() // File
            .Execute();

        return newComponent;
    }
}
