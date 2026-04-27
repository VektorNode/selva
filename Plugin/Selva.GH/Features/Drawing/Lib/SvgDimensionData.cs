using Rhino.Geometry;

namespace Selva.GH.Features.Drawing.Lib;

public class SvgDimensionData
{
    public string Body { get; set; }
    public BoundingBox Bounds { get; set; }
    public string Id { get; set; }
    public string CssClass { get; set; }
}
