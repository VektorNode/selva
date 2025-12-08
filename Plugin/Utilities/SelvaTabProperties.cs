using Grasshopper.Kernel;

namespace Selva.Utilities;

public class SelvaTabProperties: GH_AssemblyPriority
{
  public override GH_LoadingInstruction PriorityLoad()
  {
    var server = Grasshopper.Instances.ComponentServer;
    server.AddCategoryIcon("Selva", Properties.Resources.Icon);
    server.AddCategorySymbolName("Selva", 'S');
    server.AddCategoryShortName("Selva", "SV");
    return GH_LoadingInstruction.Proceed;
  }
}
