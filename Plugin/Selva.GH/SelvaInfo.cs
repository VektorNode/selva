using System;
using System.Reflection;
using Grasshopper.Kernel;

namespace Selva.GH;

public class SelvaInfo : GH_AssemblyInfo
{
    public override string Name => "Selva";

    public override System.Drawing.Bitmap Icon => null;

    public override string Description => "";

    public override Guid Id => new Guid("69ef43c6-0bc8-4b49-8e4d-a27f732cc10b");

    public override string AuthorName => "Felix Brunold, VektorNode";

    public override string AuthorContact => "felix@vektornode.com";

    public override string AssemblyVersion => GetType().Assembly.GetName().Version.ToString();

    // What a saved .gh records as the plugin's version. The numeric assembly version can't carry a
    // prerelease tag, so a beta would read as the release it precedes.
    public override string Version =>
        GetType().Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion.Split('+')[0]
        ?? AssemblyVersion;
}
