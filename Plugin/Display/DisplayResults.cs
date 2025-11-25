using System.Collections.Generic;
using Selva.Display;

namespace Selva.Components.Display;

public class DisplayResults
{
  public List<ThreeDisplayGoo> Displays { get; set; } = new();
  public List<string> Warnings { get; set; } = new();
  public string Error { get; set; }
}
