using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Grasshopper.Properties;

namespace Selva.Grasshopper;

public class SelvaInfo : GH_AssemblyInfo
{
	public override string Name => "Selva";

	//Return a 24x24 pixel bitmap to represent this GHA library.
	public override Bitmap Icon => Resources.Icon;

	//Return a short string describing the purpose of this GHA library.
	public override string Description => "";

	public override Guid Id => new("69ef43c6-0bc8-4b49-8e4d-a27f732cc10b");

	//Return a string identifying you or your company.
	public override string AuthorName => "Felix Brunold, VektorNode";

	//Return a string representing your preferred contact details.
	public override string AuthorContact => "felix@vektornode.com";

	//Return a string representing the version.  This returns the same version as the assembly.
	public override string AssemblyVersion => GetType().Assembly.GetName().Version.ToString();
}
