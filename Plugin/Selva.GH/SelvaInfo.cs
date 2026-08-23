using System;
#if !NETCOREAPP
using System.Drawing;
using Selva.GH.Properties;
#endif
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
}
