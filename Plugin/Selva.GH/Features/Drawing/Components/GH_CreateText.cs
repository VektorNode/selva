using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.GH.Properties;
using ModelStyle = Selva.Drawing.Model.Style;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateText : GH_Component
{
    public GH_CreateText()
        : base("Draw Text", "DTxt",
            "Places a text label in the drawing",
            "Selva", "Elements")
    {
    }

    protected override Bitmap Icon => Resources.DrawText;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("6B9D20CC-5566-47CF-9364-F65F9283396F");

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
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
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

        var fontSize = Math.Max(0.01, size);
        var element = new TextElement
        {
            Text = text,
            Position = new Point2D(position.X, position.Y),
            Style = new ModelStyle.TextStyle
            {
                FontSize = fontSize,
                Color = ModelStyle.Color.Rgb(color.R, color.G, color.B, color.A),
                HorizontalAnchor = (ModelStyle.TextAnchor)Math.Max(0, Math.Min(2, anchorInt)),
                VerticalAnchor = ModelStyle.VerticalAnchor.Middle,
            },
            RotationDegrees = rotation,
        };

        DA.SetData(0, element);
    }
}
