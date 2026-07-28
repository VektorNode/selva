using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateLeader : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateLeader()
        : base("Draw Leader", "DLdr",
            "Callout: a pointer line from a feature to a label",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.DrawLeader;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("8E4B17D3-2A96-4C50-B71E-5D30F9A6C284");

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
        pManager.AddPointParameter("Points", "P", "Leader polyline in world XY space, in order: arrow tip first, then any knee, then the text anchor. Two or three points is typical", GH_ParamAccess.list);
        pManager.AddTextParameter("Text", "T", "Label drawn at the last point", GH_ParamAccess.item, "");
        pManager.AddParameter(new Param_TextStyle("Text Style", "TS", "Label text style (use Text Style component; leave empty for default)", "Selva", "Elements", GH_ParamAccess.item));
        pManager.AddParameter(new Param_Stroke("Stroke", "S", "Leader line stroke (use Path Style component; leave empty for default)", "Selva", "Elements", GH_ParamAccess.item));
        pManager.AddIntegerParameter("Head", "H", "Head drawn at the first point", GH_ParamAccess.item, 0);
        pManager.AddNumberParameter("Head Size", "HZ", "Arrow/dot size in mm on the printed sheet", GH_ParamAccess.item, 4.0);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;

        if (pManager[4] is Param_Integer headParam)
        {
            headParam.AddNamedValue("Arrow", 0);
            headParam.AddNamedValue("Dot", 1);
            headParam.AddNamedValue("None", 2);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var points = new List<Point3d>();
        var text = "";
        TextStyle textStyle = null;
        Stroke stroke = null;
        var head = 0;
        var headSize = 4.0;

        if (!DA.GetDataList(0, points)) return;
        DA.GetData(1, ref text);
        DA.GetData(2, ref textStyle);
        DA.GetData(3, ref stroke);
        DA.GetData(4, ref head);
        DA.GetData(5, ref headSize);

        if (points.Count < 2)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Leader needs at least two points");
            return;
        }

        var pts = new DrawPoint[points.Count];
        for (var i = 0; i < points.Count; i++) pts[i] = new DrawPoint(points[i].X, points[i].Y);

        var element = new LeaderElement
        {
            Points = pts,
            Text = text ?? "",
            TextStyle = textStyle ?? new TextStyle(),
            Stroke = stroke ?? new Stroke(),
            Head = (LeaderHead)Math.Max(0, Math.Min(2, head)),
            HeadSize = Math.Max(0, headSize),
        };

        _preview.Add(element);
        DA.SetData(0, element);
    }
}
