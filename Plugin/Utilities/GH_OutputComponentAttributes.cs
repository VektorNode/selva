using System.Drawing;
using Grasshopper.Kernel;
using Selva.Features.FileIO.Components;

public class GH_ContextBakeOutputAttributes  : GH_AccentComponentAttributes
{
  protected override Color AccentColor => Color.FromArgb(180, 210, 170);

  public GH_ContextBakeOutputAttributes(IGH_Component component) : base(component)
  {
  }
}

