using System.Collections.Generic;

namespace Selva.Features.Display.Services;

public class DisplayResults
{
  public List<ThreeDisplayGoo> Displays { get; set; } = new();
  public List<string> Warnings { get; set; } = new();
  public string Error { get; set; }
}
