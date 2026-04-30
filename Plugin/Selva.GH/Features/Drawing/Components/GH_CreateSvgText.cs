using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateSvgText : GH_Component
{
    public GH_CreateSvgText()
        : base("Create SVG Text", "CST",
            "Places a text label in the SVG drawing",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("8B4F2D1E-9A6C-4F3B-B7E1-2C5D8E0A1B34");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Text", "T", "Text string", GH_ParamAccess.item);
        pManager.AddPointParameter("Position", "P", "Anchor point in world XY space", GH_ParamAccess.item);
        pManager.AddNumberParameter("Size", "S", "Font size in drawing units", GH_ParamAccess.item, 3.0);
        pManager.AddColourParameter("Color", "C", "Text color", GH_ParamAccess.item, Color.Black);
        pManager.AddIntegerParameter("Anchor", "A", "Horizontal anchor: 0=Left, 1=Center, 2=Right", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Rotation", "R", "Rotation angle in degrees (counter-clockwise)", GH_ParamAccess.item, 0.0);

        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Text", "ST", "SVG text element data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var text = "";
        var position = Point3d.Unset;
        var size = 3.0;
        var color = Color.Black;
        var anchorInt = 0;
        var rotation = 0.0;

        if (!DA.GetData(0, ref text)) return;
        if (!DA.GetData(1, ref position) || position == Point3d.Unset) return;
        DA.GetData(2, ref size);
        DA.GetData(3, ref color);
        DA.GetData(4, ref anchorInt);
        DA.GetData(5, ref rotation);

        var halfH = size * 0.5;
        var approxW = text.Length * size * 0.6;
        double bx0, bx1;
        switch (anchorInt)
        {
            case 1:
                bx0 = position.X - approxW * 0.5;
                bx1 = position.X + approxW * 0.5;
                break;
            case 2:
                bx0 = position.X - approxW;
                bx1 = position.X;
                break;
            default:
                bx0 = position.X;
                bx1 = position.X + approxW;
                break;
        }
        var bounds = new SvgBounds(bx0, position.Y - halfH, bx1, position.Y + halfH);

        DA.SetData(0, new SvgTextData
        {
            Text = text,
            X = position.X,
            Y = position.Y,
            FontSize = Math.Max(0.01, size),
            Color = color,
            Anchor = (SvgTextAnchor)Math.Max(0, Math.Min(2, anchorInt)),
            RotationDegrees = rotation,
            Bounds = bounds
        });
    }
}
