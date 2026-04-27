using System.Drawing;

namespace Selva.GH.Features.Drawing.Lib;

public enum SvgStrokeCap { Butt, Round, Square }
public enum SvgStrokeJoin { Miter, Round, Bevel }

public class PathStyleData
{
    public Color StrokeColor { get; set; } = Color.Black;
    public Color FillColor { get; set; } = Color.Transparent;
    public bool HasStroke { get; set; } = true;
    public bool HasFill { get; set; } = false;
    public float StrokeWidth { get; set; } = 1.0f;
    public float StrokeOpacity { get; set; } = 1.0f;
    public float FillOpacity { get; set; } = 1.0f;
    public SvgStrokeCap StrokeCap { get; set; } = SvgStrokeCap.Butt;
    public SvgStrokeJoin StrokeJoin { get; set; } = SvgStrokeJoin.Miter;
    public float[] DashArray { get; set; } = null;
    public bool NonScalingStroke { get; set; } = false;
}
