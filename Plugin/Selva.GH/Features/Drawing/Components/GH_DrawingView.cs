using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 8 composite component: a scaled view of geometry with optional border and caption.
public class GH_DrawingView : GH_Component
{
    public GH_DrawingView()
        : base("Drawing View", "DView",
            "Scaled view of geometry with optional bordered frame and caption",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.DrawingView;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("F1234567-89AB-4CDE-F123-456789ABCDEF");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Geometry", "G", "Drawing element to display in the view", GH_ParamAccess.item);
        pManager.AddNumberParameter("Scale", "S", "Drawing scale (1.0 = full, 0.2 = 1:5)", GH_ParamAccess.item, 1.0);
        pManager.AddGenericParameter("Border", "B", "Stroke style for the frame (leave empty for none)", GH_ParamAccess.item);
        pManager.AddNumberParameter("Padding", "P", "Padding around geometry in millimetres", GH_ParamAccess.item, 2.0);
        pManager.AddTextParameter("Caption", "C", "Caption text shown below the frame (e.g. \"SCALE 1:5\")", GH_ParamAccess.item, "");
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the view in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("View", "V", "Drawing view element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        DrawElement geometry = null;
        var scale = 1.0;
        Stroke border = null;
        var padding = 2.0;
        var caption = "";
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref geometry);
        DA.GetData(1, ref scale);
        DA.GetData(2, ref border);
        DA.GetData(3, ref padding);
        DA.GetData(4, ref caption);
        DA.GetData(5, ref origin);

        var view = new DrawingView
        {
            Geometry = geometry,
            Scale = scale > 0 ? scale : 1.0,
            Border = border,
            Padding = Margins.Uniform(Math.Max(0, padding)),
            Caption = caption,
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, view);
    }
}
