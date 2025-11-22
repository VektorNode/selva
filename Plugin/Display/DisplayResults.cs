using System.Collections.Generic;
using ComputeBuilder.Display;

namespace ComputeBuilder.Components.Display;

public class DisplayResults
{
  public List<ThreeDisplayGoo> Displays { get; set; } = new();
  public List<string> Warnings { get; set; } = new();
  public string Error { get; set; }
}
