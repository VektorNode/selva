using System.Collections.Generic;

namespace Selva.Features.Display.Services;

public class DisplayResults
{
  public List<MeshBatchGoo> Displays { get; set; } = new();
  public List<string> Warnings { get; set; } = new();
  public List<string> Remarks { get; set; } = new();
  public string Error { get; set; }
}
