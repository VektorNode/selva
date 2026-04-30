using System.Collections.Generic;

namespace Selva.Drawing;

public class SvgSurfaceData
{
    public string OuterPathData { get; set; }
    public List<string> HolePathData { get; set; } = new List<string>();
    public SvgBounds Bounds { get; set; }
    public PathStyleData Style { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new Dictionary<string, string>();
    public string Id { get; set; }
    public string CssClass { get; set; }

    public string CombinedPathData =>
        HolePathData.Count == 0
            ? OuterPathData
            : OuterPathData + " " + string.Join(" ", HolePathData);
}
