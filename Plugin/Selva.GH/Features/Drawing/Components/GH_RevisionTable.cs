using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 8 composite component: bordered, headered revision-history table. Inputs are four
// parallel lists (Revision / Date / Description / By); each index is one row of the table.
public class GH_RevisionTable : GH_Component
{
    public GH_RevisionTable()
        : base("Revision Table", "Rev",
            "Drawing revision history table",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.RevisionTable;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("A4CD58ED-35CA-47AC-8505-F1DCAB1FBCD2");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Revisions", "R", "Revision tags (parallel to other inputs)", GH_ParamAccess.list);
        pManager.AddTextParameter("Dates", "D", "Revision dates", GH_ParamAccess.list);
        pManager.AddTextParameter("Descriptions", "Ds", "Revision descriptions", GH_ParamAccess.list);
        pManager.AddTextParameter("By", "B", "Revision authors / initials", GH_ParamAccess.list);
        pManager.AddNumberParameter("Width", "W", "Total width in millimetres", GH_ParamAccess.item, 120.0);
        pManager.AddGenericParameter("Border", "Br", "Stroke style for borders (leave empty for default 0.25mm)", GH_ParamAccess.item);
        pManager.AddPointParameter("Origin", "O", "Bottom-left in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var revisions = new List<string>();
        var dates = new List<string>();
        var descriptions = new List<string>();
        var by = new List<string>();
        var width = 120.0;
        Stroke border = null;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetDataList(0, revisions);
        DA.GetDataList(1, dates);
        DA.GetDataList(2, descriptions);
        DA.GetDataList(3, by);
        DA.GetData(4, ref width);
        DA.GetData(5, ref border);
        DA.GetData(6, ref origin);

        var rowCount = Math.Max(Math.Max(revisions.Count, dates.Count), Math.Max(descriptions.Count, by.Count));
        var entries = new List<RevisionEntry>(rowCount);
        for (var i = 0; i < rowCount; i++)
        {
            entries.Add(new RevisionEntry
            {
                Revision = i < revisions.Count ? revisions[i] : "",
                Date = i < dates.Count ? dates[i] : "",
                Description = i < descriptions.Count ? descriptions[i] : "",
                By = i < by.Count ? by[i] : "",
            });
        }

        var table = new RevisionTable
        {
            Entries = entries,
            Width = Math.Max(20, width),
            Border = border ?? new Stroke { Width = 0.25 },
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, table);
    }
}
