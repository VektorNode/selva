using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 8 composite component: a small two-column legend (swatch + description). Swatches
// are arbitrary DrawElements (line samples, hatch tiles, symbol elements); descriptions are
// parallel strings.
public class GH_LegendBlock : GH_Component
{
    public GH_LegendBlock()
        : base("Legend Block", "Legend",
            "Two-column legend with symbol swatches and descriptions",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.LegendBlock;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("3456789A-BCDE-4F01-2345-6789ABCDEF01");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Title", "T", "Optional block title (leave empty for none)", GH_ParamAccess.item, "");
        pManager.AddGenericParameter("Swatches", "S", "Drawing elements shown in the swatch column", GH_ParamAccess.list);
        pManager.AddTextParameter("Descriptions", "D", "Description text for each swatch", GH_ParamAccess.list);
        pManager.AddNumberParameter("Width", "W", "Total width in millimetres", GH_ParamAccess.item, 80.0);
        pManager.AddNumberParameter("Swatch Width", "Sw", "Swatch column width in millimetres", GH_ParamAccess.item, 18.0);
        pManager.AddGenericParameter("Border", "B", "Stroke style for borders", GH_ParamAccess.item);
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
        var title = "";
        var swatches = new List<DrawElement>();
        var descriptions = new List<string>();
        var width = 80.0;
        var swatchWidth = 18.0;
        Stroke border = null;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref title);
        DA.GetDataList(1, swatches);
        DA.GetDataList(2, descriptions);
        DA.GetData(3, ref width);
        DA.GetData(4, ref swatchWidth);
        DA.GetData(5, ref border);
        DA.GetData(6, ref origin);

        var rowCount = Math.Max(swatches.Count, descriptions.Count);
        var entries = new List<LegendEntry>(rowCount);
        for (var i = 0; i < rowCount; i++)
        {
            entries.Add(new LegendEntry
            {
                Swatch = i < swatches.Count ? swatches[i] : null,
                Description = i < descriptions.Count ? descriptions[i] : "",
            });
        }

        var legend = new LegendBlock
        {
            Title = title,
            Entries = entries,
            Width = Math.Max(20, width),
            SwatchColumnWidth = Math.Max(5, swatchWidth),
            Border = border ?? new Stroke { Width = 0.25 },
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, legend);
    }
}
