using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Geometry;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 8 composite component: drawing title block driven by paired Label/Value lists.
// For non-trivial layouts users wire a TitleBlock instance directly via C#; this component
// produces the most common "Standard" layout (4 rows × variable columns) using a flat list
// of named values: Project, Client, Title, DrawingNumber, Revision, Scale, Sheet, Author,
// Date, Checker. Empty strings are kept (rendered as blanks).
public class GH_TitleBlock : GH_Component
{
    public GH_TitleBlock()
        : base("Title Block", "Title",
            "Standard drawing title block with project / drawing-number / scale / revision fields",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.TitleBlock;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("12345678-9ABC-4DEF-0123-456789ABCDEF");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Project", "Pr", "Project name", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Client", "Cl", "Client name", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Title", "T", "Drawing title", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Drawing No", "D", "Drawing number", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Revision", "R", "Revision tag", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Scale", "S", "Drawing scale", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Sheet", "Sh", "Sheet number (e.g. \"1 of 3\")", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Author", "A", "Drafter name/initials", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Date", "Dt", "Drafting date", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Checker", "Ch", "Checker name/initials", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Width", "W", "Block width in millimetres", GH_ParamAccess.item, 180.0);
        pManager.AddNumberParameter("Height", "H", "Block height in millimetres", GH_ParamAccess.item, 40.0);
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the block in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        for (var i = 0; i < 13; i++) pManager[i].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string project = "", client = "", title = "", drawingNo = "", revision = "",
            scale = "", sheet = "", author = "", date = "", checker = "";
        var width = 180.0;
        var height = 40.0;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref project);
        DA.GetData(1, ref client);
        DA.GetData(2, ref title);
        DA.GetData(3, ref drawingNo);
        DA.GetData(4, ref revision);
        DA.GetData(5, ref scale);
        DA.GetData(6, ref sheet);
        DA.GetData(7, ref author);
        DA.GetData(8, ref date);
        DA.GetData(9, ref checker);
        DA.GetData(10, ref width);
        DA.GetData(11, ref height);
        DA.GetData(12, ref origin);

        var values = new Dictionary<string, string>
        {
            ["Project"] = project ?? "",
            ["Client"] = client ?? "",
            ["Title"] = title ?? "",
            ["DrawingNumber"] = drawingNo ?? "",
            ["Revision"] = revision ?? "",
            ["Scale"] = scale ?? "",
            ["Sheet"] = sheet ?? "",
            ["Author"] = author ?? "",
            ["Date"] = date ?? "",
            ["Checker"] = checker ?? "",
        };

        var size = new BoundingBox(0, 0, Math.Max(1, width), Math.Max(1, height));
        var block = TitleBlock.Standard(values, size);
        block = new TitleBlock
        {
            Rows = block.Rows,
            Size = size,
            Border = block.Border,
            InnerBorder = block.InnerBorder,
            LabelStyle = block.LabelStyle,
            ValueStyle = block.ValueStyle,
            CellPadding = block.CellPadding,
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, block);
    }
}
