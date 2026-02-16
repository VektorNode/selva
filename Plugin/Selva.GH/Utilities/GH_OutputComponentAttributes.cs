using System.Drawing;
using Grasshopper.Kernel;

namespace Selva.GH.Utilities;

public class GH_ContextBakeOutputAttributes : GH_AccentComponentAttributes
{
	public GH_ContextBakeOutputAttributes(IGH_Component component) : base(component)
	{
	}

	protected override Color AccentColor => Color.FromArgb(133, 52, 133);
}
