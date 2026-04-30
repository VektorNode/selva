using System.Collections.Generic;

namespace Selva.Drawing;

public class SvgCurveData
{
    public string PathData { get; set; }
    public SvgBounds Bounds { get; set; }
    public PathStyleData Style { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new Dictionary<string, string>();
    public string Id { get; set; }
    public string CssClass { get; set; }
}
