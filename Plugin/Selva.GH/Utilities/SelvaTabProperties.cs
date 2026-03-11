using Grasshopper.Kernel;
using Selva.GH.Properties;
using Instances = Grasshopper.Instances;

namespace Selva.GH.Utilities;

public class SelvaTabProperties : GH_AssemblyPriority
{
    public override GH_LoadingInstruction PriorityLoad()
    {
        var server = Instances.ComponentServer;
        server.AddCategoryIcon("Selva", Resources.Icon);
        server.AddCategorySymbolName("Selva", 'S');
        server.AddCategoryShortName("Selva", "SV");
        return GH_LoadingInstruction.Proceed;
    }
}
