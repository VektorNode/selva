using System.Collections.Generic;
using Rhino.Geometry;

namespace Selva.GH.Features.Drawing.Lib;

public class SvgCurveData
{
    public string PathData { get; set; }
    public BoundingBox Bounds { get; set; }
    public PathStyleData Style { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new();
    public string Id { get; set; }
    public string CssClass { get; set; }
}
