using System.IO.Compression;
using Grasshopper.Kernel;
using Rhino;
using Selva.GH.Features.Display.Services;
using Selva.GH.Features.SolveRuntime.Services;
using Selva.GH.Features.UIBuilder.Services;
using Selva.GH.Properties;
using Selva.Slva;
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

        // Rhino.Compute loads Selva too, and has no panel to launch from. RhinoApp, not
        // HeadlessGuard: there may be no Rhino document yet while Grasshopper loads.
        if (!RhinoApp.IsRunningHeadless)
        {
            DefinitionLauncher.Register();
            PanelCanvasFollower.Register();
            DisplayCaches.ClearOnDocumentClose();
            MacSolveActivity.Register();
            SlvzCompressor.Level = CompressionLevel.Fastest;
        }

        return GH_LoadingInstruction.Proceed;
    }
}
