using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;
using Color = System.Drawing.Color;
using ModelStyle = Selva.Drawing.Model.Style;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateText : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateText()
        : base("Draw Text", "DTxt",
            "Places a text label in the drawing",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.DrawText;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
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
        pManager.AddParameter(new Param_TextStyle("Style", "S", "Text style (use Text Style component; leave empty for default)", "Selva", "Elements", GH_ParamAccess.item));
        pManager.AddNumberParameter("Rotation", "R", "Rotation angle in degrees (counter-clockwise)", GH_ParamAccess.item, 0.0);
        pManager.AddColourParameter("Background", "B", "Optional background color drawn behind the text. Leave unset for no background.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Padding", "Pd", "Background padding around the text (only used when Background is set)", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Radius", "Rd", "Background corner radius (only used when Background is set)", GH_ParamAccess.item, 0.0);

        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var text = "";
        var position = Point3d.Unset;
        TextStyle style = null;
        var rotation = 0.0;
        Color background = Color.Empty;
        var padding = 1.0;
        var radius = 0.0;

        if (!DA.GetData(0, ref text)) return;
        if (!DA.GetData(1, ref position) || position == Point3d.Unset) return;
        DA.GetData(2, ref style);
        DA.GetData(3, ref rotation);
        var hasBackground = DA.GetData(4, ref background);
        DA.GetData(5, ref padding);
        DA.GetData(6, ref radius);

        var element = new TextElement
        {
            Text = text,
            Position = new DrawPoint(position.X, position.Y),
            Style = style ?? new TextStyle(),
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
