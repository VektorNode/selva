using System.Collections.Generic;
using Rhino.Geometry;

namespace Selva.GH.Features.Drawing.Lib;

public class SvgSurfaceData
{
    public string OuterPathData { get; set; }
    public List<string> HolePathData { get; set; } = new();
    public BoundingBox Bounds { get; set; }
    public PathStyleData Style { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new();
    public string Id { get; set; }
    public string CssClass { get; set; }

    public string CombinedPathData =>
        HolePathData.Count == 0
            ? OuterPathData
            : OuterPathData + " " + string.Join(" ", HolePathData);
}
