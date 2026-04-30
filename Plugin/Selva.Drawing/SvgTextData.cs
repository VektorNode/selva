using System.Collections.Generic;
using System.Drawing;

namespace Selva.Drawing;

public enum SvgTextAnchor { Left, Center, Right }

public class SvgTextData
{
    public string Text { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public double FontSize { get; set; } = 3.0;
    public Color Color { get; set; } = Color.Black;
    public SvgTextAnchor Anchor { get; set; } = SvgTextAnchor.Left;
    public double RotationDegrees { get; set; } = 0.0;
    public SvgBounds Bounds { get; set; }
    public string Id { get; set; }
    public string CssClass { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new Dictionary<string, string>();

}
