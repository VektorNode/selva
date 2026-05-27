using System;
using System.IO;
using System.Reflection;
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

#if !NETCOREAPP
        // On .NET Framework (net48), the fusion loader can refuse to load a strong-named
        // assembly from a private path if a different version is already in the process.
        // Register a resolver so Selva's own copies of its dependencies win.
        AppDomain.CurrentDomain.AssemblyResolve += ResolveFromPluginDirectory;
#endif

        return GH_LoadingInstruction.Proceed;
    }

#if !NETCOREAPP
    private static readonly string PluginDirectory =
        Path.GetDirectoryName(typeof(SelvaTabProperties).Assembly.Location) ?? "";

    private static Assembly? ResolveFromPluginDirectory(object sender, ResolveEventArgs args)
    {
        var name = new AssemblyName(args.Name).Name;
        var path = Path.Combine(PluginDirectory, name + ".dll");
        return File.Exists(path) ? Assembly.LoadFrom(path) : null;
    }
#endif
}
