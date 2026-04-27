using System;
using System.Drawing;
using System.Globalization;
using System.Text;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_LinearDimension : GH_Component
{
    public GH_LinearDimension()
        : base("Linear Dimension", "LDim",
            "Aligned linear dimension between two points, offset perpendicular to the segment",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.secondary;
    public override Guid ComponentGuid => new Guid("4F5C5A8B-7B0E-4D11-9E0E-5A0F4D4C9B12");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddPointParameter("Point A", "A", "Start point", GH_ParamAccess.item);
        pManager.AddPointParameter("Point B", "B", "End point", GH_ParamAccess.item);
        pManager.AddNumberParameter("Offset", "O", "Perpendicular offset distance (positive = left of A→B)", GH_ParamAccess.item, 5.0);
        pManager.AddTextParameter("Label", "L", "Override label (default: distance)", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Text Size", "TS", "Text height in drawing units", GH_ParamAccess.item, 2.5);
        pManager.AddColourParameter("Color", "C", "Dimension color", GH_ParamAccess.item, Color.Black);
        pManager.AddNumberParameter("Stroke Width", "SW", "Line stroke width", GH_ParamAccess.item, 0.5);
        pManager.AddTextParameter("CSS Class", "Cls", "Extra CSS class", GH_ParamAccess.item, "");

        pManager[3].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Dimension", "SD", "SVG dimension data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var a = Point3d.Unset;
        var b = Point3d.Unset;
        var offset = 5.0;
        var label = "";
        var textSize = 2.5;
        var color = Color.Black;
        var stroke = 0.5;
        var cls = "";

        if (!DA.GetData(0, ref a)) return;
        if (!DA.GetData(1, ref b)) return;
        DA.GetData(2, ref offset);
        DA.GetData(3, ref label);
        DA.GetData(4, ref textSize);
        DA.GetData(5, ref color);
        DA.GetData(6, ref stroke);
        DA.GetData(7, ref cls);

        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var len = Math.Sqrt(dx * dx + dy * dy);
        if (len < 1e-9)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Points coincide");
            return;
        }

        // Unit direction along A→B and perpendicular (left side, +90°)
        var ux = dx / len;
        var uy = dy / len;
        var nx = -uy;
        var ny = ux;

        // Dimension line endpoints (offset perpendicular)
        var aOff = new Point3d(a.X + nx * offset, a.Y + ny * offset, 0);
        var bOff = new Point3d(b.X + nx * offset, b.Y + ny * offset, 0);

        // Text midpoint, lifted slightly off the dim line for legibility
        var textLift = textSize * 0.4;
        var midX = (aOff.X + bOff.X) * 0.5 + nx * textLift;
        var midY = (aOff.Y + bOff.Y) * 0.5 + ny * textLift;

        // Text rotation in Rhino-world degrees. The root Y-flip would invert text,
        // so we apply an inner Y-flip for the text element to render correctly.
        var angleDeg = Math.Atan2(uy, ux) * 180.0 / Math.PI;
        // Keep text upright: if it would be upside down, flip 180°.
        if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

        var text = string.IsNullOrEmpty(label)
            ? len.ToString("0.##", CultureInfo.InvariantCulture)
            : label;

        var sb = new StringBuilder();
        var strokeAttr = $"stroke='{SvgWriter.Rgb(color)}' stroke-width='{SvgWriter.F(stroke)}' fill='none' vector-effect='non-scaling-stroke'";

        // Extension lines (from measured points to dimension line)
        sb.Append("    <line ").Append(strokeAttr)
          .Append(" x1='").Append(SvgWriter.F(a.X)).Append("' y1='").Append(SvgWriter.F(a.Y))
          .Append("' x2='").Append(SvgWriter.F(aOff.X)).Append("' y2='").Append(SvgWriter.F(aOff.Y))
          .AppendLine("' />");
        sb.Append("    <line ").Append(strokeAttr)
          .Append(" x1='").Append(SvgWriter.F(b.X)).Append("' y1='").Append(SvgWriter.F(b.Y))
          .Append("' x2='").Append(SvgWriter.F(bOff.X)).Append("' y2='").Append(SvgWriter.F(bOff.Y))
          .AppendLine("' />");

        // Dimension line with arrow markers on both ends
        sb.Append("    <line ").Append(strokeAttr)
          .Append(" marker-start='url(#selva-dim-arrow)' marker-end='url(#selva-dim-arrow)'")
          .Append(" x1='").Append(SvgWriter.F(aOff.X)).Append("' y1='").Append(SvgWriter.F(aOff.Y))
          .Append("' x2='").Append(SvgWriter.F(bOff.X)).Append("' y2='").Append(SvgWriter.F(bOff.Y))
          .AppendLine("' />");

        // Label — position via transform so we can compose: translate to midpoint,
        // counter-flip Y (cancels the root Y-flip so text is right-side-up),
        // then rotate to align with the dim line. Text origin is at (0,0) post-transform.
        sb.Append("    <text x='0' y='0'")
          .Append(" font-size='").Append(SvgWriter.F(textSize)).Append('\'')
          .Append(" fill='").Append(SvgWriter.Rgb(color)).Append('\'')
          .Append(" text-anchor='middle' dominant-baseline='middle'")
          .Append(" transform='translate(").Append(SvgWriter.F(midX)).Append(' ').Append(SvgWriter.F(midY))
          .Append(") scale(1 -1) rotate(").Append(SvgWriter.F(-angleDeg)).Append(")'")
          .Append('>').Append(SvgWriter.Escape(text)).AppendLine("</text>");

        var bb = BoundingBox.Empty;
        bb.Union(a);
        bb.Union(b);
        bb.Union(aOff);
        bb.Union(bOff);

        DA.SetData(0, new SvgDimensionData
        {
            Body = sb.ToString(),
            Bounds = bb,
            CssClass = cls
        });
    }
}
