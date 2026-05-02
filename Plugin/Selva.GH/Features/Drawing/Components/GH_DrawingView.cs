using System;
using System.Collections.Generic;
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
    public override Guid ComponentGuid => new Guid("3336B561-6152-4CA0-83D6-C0F5EED76540");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Geometry", "G", "Drawing elements to display in the view. Multiple elements are grouped together with their world coordinates preserved before scaling.", GH_ParamAccess.list);
        pManager.AddNumberParameter("Scale", "S", "Drawing scale (1.0 = full, 0.2 = 1:5). Set to 0 with Width/Height to auto-fit.", GH_ParamAccess.item, 1.0);
        pManager.AddGenericParameter("Border", "B", "Stroke style for the frame (leave empty for none)", GH_ParamAccess.item);
        pManager.AddNumberParameter("Padding", "P", "Padding around geometry in millimetres", GH_ParamAccess.item, 2.0);
        pManager.AddTextParameter("Caption", "C", "Caption text shown below the frame (e.g. \"SCALE 1:5\")", GH_ParamAccess.item, "");
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the view in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));
        pManager.AddNumberParameter("Width", "W", "Optional fixed view width in mm. When both Width and Height are set, the view occupies that rectangle. Combine with Scale = 0 to auto-fit geometry.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Height", "H", "Optional fixed view height in mm. When both Width and Height are set, the view occupies that rectangle. Combine with Scale = 0 to auto-fit geometry.", GH_ParamAccess.item, 0.0);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("View", "V", "Drawing view element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var elements = new List<DrawElement>();
        var scale = 1.0;
        Stroke border = null;
        var padding = 2.0;
        var caption = "";
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);
        var width = 0.0;
        var height = 0.0;

        DA.GetDataList(0, elements);
        DA.GetData(1, ref scale);
        DA.GetData(2, ref border);
        DA.GetData(3, ref padding);
        DA.GetData(4, ref caption);
        DA.GetData(5, ref origin);
        DA.GetData(6, ref width);
        DA.GetData(7, ref height);

        // Drop nulls. Multiple elements are wrapped in a Group so their relative world
        // coordinates are preserved before DrawingView centres + scales the lot.
        var children = new List<DrawElement>(elements.Count);
        foreach (var e in elements) if (e != null) children.Add(e);

        DrawElement geometry = children.Count switch
        {
            0 => null,
            1 => children[0],
            _ => new GroupElement { Children = children },
        };

        BoundingBox? size = null;
        if (width > 0 && height > 0)
        {
            size = new BoundingBox(0, 0, width, height);
        }

        var view = new DrawingView
        {
            Geometry = geometry,
            // Scale = 0 is the auto-fit signal when Size is set; otherwise keep the
            // existing "0 falls back to 1.0" behaviour.
            Scale = size.HasValue ? scale : (scale > 0 ? scale : 1.0),
            Size = size,
            Border = border,
            Padding = Margins.Uniform(Math.Max(0, padding)),
            Caption = caption,
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, view);
    }
}
