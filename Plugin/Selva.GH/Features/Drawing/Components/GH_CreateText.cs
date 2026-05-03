using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;
using ModelStyle = Selva.Drawing.Model.Style;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateText : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateText()
        : base("Draw Text", "DTxt",
            "Places a text label in the drawing",
            "Selva", "Elements")
    {
    }

    protected override Bitmap Icon => Resources.DrawText;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("6B9D20CC-5566-47CF-9364-F65F9283396F");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _preview.ClippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _preview.Clear();
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden) return;
        _preview.Render(args);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Text", "T", "Text string", GH_ParamAccess.item);
        pManager.AddPointParameter("Position", "P", "Anchor point in world XY space", GH_ParamAccess.item);
        pManager.AddNumberParameter("Size", "S", "Font size in drawing units", GH_ParamAccess.item, 3.0);
        pManager.AddColourParameter("Color", "C", "Text color", GH_ParamAccess.item, Color.Black);
        pManager.AddIntegerParameter("Align", "A", "Horizontal alignment: 0=Left, 1=Center, 2=Right", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Rotation", "R", "Rotation angle in degrees (counter-clockwise)", GH_ParamAccess.item, 0.0);
        pManager.AddColourParameter("Background", "B", "Optional background color drawn behind the text. Leave unset for no background.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Padding", "Pd", "Background padding around the text (only used when Background is set)", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Radius", "Rd", "Background corner radius (only used when Background is set)", GH_ParamAccess.item, 0.0);

        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
        pManager[8].Optional = true;


        if (pManager[4] is Param_Integer alignParam)
        {
            alignParam.AddNamedValue("Left", 0);
            alignParam.AddNamedValue("Center", 1);
            alignParam.AddNamedValue("Right", 2);
        }
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
        var alignInt = 0;
        var rotation = 0.0;
        Color background = Color.Empty;
        var padding = 1.0;
        var radius = 0.0;

        if (!DA.GetData(0, ref text)) return;
        if (!DA.GetData(1, ref position) || position == Point3d.Unset) return;
        DA.GetData(2, ref size);
        DA.GetData(3, ref color);
        DA.GetData(4, ref alignInt);
        DA.GetData(5, ref rotation);
        var hasBackground = DA.GetData(6, ref background);
        DA.GetData(7, ref padding);
        DA.GetData(8, ref radius);

        var fontSize = Math.Max(0.01, size);
        var element = new TextElement
        {
            Text = text,
            Position = new DrawPoint(position.X, position.Y),
            Style = new ModelStyle.TextStyle
            {
                FontSize = fontSize,
                Color = ModelStyle.Color.Rgb(color.R, color.G, color.B, color.A),
                HorizontalAnchor = (ModelStyle.TextAnchor)Math.Max(0, Math.Min(2, alignInt)),
                VerticalAnchor = ModelStyle.VerticalAnchor.Middle,
            },
            RotationDegrees = rotation,
            Background = hasBackground
                ? new ModelStyle.Color?(ModelStyle.Color.Rgb(background.R, background.G, background.B, background.A))
                : null,
            BackgroundPadding = hasBackground ? Math.Max(0, padding) : 0,
            BackgroundCornerRadius = hasBackground ? Math.Max(0, radius) : 0,
        };

        _preview.Add(element);
        DA.SetData(0, element);
    }
}
