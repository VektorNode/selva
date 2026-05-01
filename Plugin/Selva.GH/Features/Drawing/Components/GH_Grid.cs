using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using Grasshopper.Kernel;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: a flex grid where columns and rows are described by a small
// DSL — space-separated tokens, each one of `<mm>` (absolute), `auto`, or `<weight>*`
// (star track). Cells are placed via parallel lists: Children + Rows + Columns + Spans.
public class GH_Grid : GH_Component
{
    public GH_Grid()
        : base("Grid", "Grid",
            "Flex grid with absolute / auto / star tracks. Track DSL: \"40 auto 1* 2*\".",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.Grid;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("D9F0A123-3C4D-4E5F-B071-829304B5C6D7");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Columns", "C", "Column-track DSL: space-separated <mm>|auto|<weight>* (e.g. \"40 auto 1*\")", GH_ParamAccess.item, "auto");
        pManager.AddTextParameter("Rows", "R", "Row-track DSL", GH_ParamAccess.item, "auto");
        pManager.AddGenericParameter("Cell Children", "Ch", "Cell content (one element per cell)", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Cell Rows", "Cr", "Row index per cell, 0-based (parallel to Children)", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Cell Columns", "Cc", "Column index per cell, 0-based (parallel to Children)", GH_ParamAccess.list);
        pManager.AddNumberParameter("Column Spacing", "CS", "Spacing between columns in mm", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Row Spacing", "RS", "Spacing between rows in mm", GH_ParamAccess.item, 0.0);
        pManager.AddPointParameter("Origin", "O", "Bottom-left of the grid in world coordinates", GH_ParamAccess.item, new Rhino.Geometry.Point3d(0, 0, 0));

        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var columnsDsl = "auto";
        var rowsDsl = "auto";
        var children = new List<DrawElement>();
        var rows = new List<int>();
        var cols = new List<int>();
        var colSpacing = 0.0;
        var rowSpacing = 0.0;
        var origin = new Rhino.Geometry.Point3d(0, 0, 0);

        DA.GetData(0, ref columnsDsl);
        DA.GetData(1, ref rowsDsl);
        DA.GetDataList(2, children);
        DA.GetDataList(3, rows);
        DA.GetDataList(4, cols);
        DA.GetData(5, ref colSpacing);
        DA.GetData(6, ref rowSpacing);
        DA.GetData(7, ref origin);

        if (children.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No cell content provided");
            return;
        }
        if (rows.Count != children.Count || cols.Count != children.Count)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                "Cell Children, Cell Rows, and Cell Columns must have matching counts");
            return;
        }

        var columnTracks = ParseTracks(columnsDsl);
        var rowTracks = ParseTracks(rowsDsl);

        if (rowTracks.Count == 0 || columnTracks.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                "Columns and Rows DSL must each declare at least one track");
            return;
        }

        var cells = new List<GridCell>(children.Count);
        for (var i = 0; i < children.Count; i++)
        {
            if (rows[i] < 0 || rows[i] >= rowTracks.Count)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    $"Cell {i}: row index {rows[i]} is outside [0, {rowTracks.Count - 1}]");
                return;
            }
            if (cols[i] < 0 || cols[i] >= columnTracks.Count)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    $"Cell {i}: column index {cols[i]} is outside [0, {columnTracks.Count - 1}]");
                return;
            }
            cells.Add(new GridCell { Row = rows[i], Column = cols[i], Content = children[i] });
        }

        var grid = new Grid
        {
            Columns = columnTracks,
            Rows = rowTracks,
            Cells = cells,
            ColumnSpacing = Math.Max(0, colSpacing),
            RowSpacing = Math.Max(0, rowSpacing),
            Origin = new Point2D(origin.X, origin.Y),
        };

        DA.SetData(0, grid);
    }

    private static IReadOnlyList<GridLength> ParseTracks(string dsl)
    {
        var list = new List<GridLength>();
        if (string.IsNullOrWhiteSpace(dsl)) return list;
        foreach (var raw in dsl.Split(new[] { ' ', '\t', ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = raw.Trim();
            if (t.Equals("auto", StringComparison.OrdinalIgnoreCase))
            {
                list.Add(GridLength.Auto);
            }
            else if (t.EndsWith("*"))
            {
                var w = t.Substring(0, t.Length - 1);
                var weight = w.Length == 0 ? 1.0
                    : double.Parse(w, NumberStyles.Float, CultureInfo.InvariantCulture);
                list.Add(GridLength.Star(weight));
            }
            else
            {
                var mm = double.Parse(t, NumberStyles.Float, CultureInfo.InvariantCulture);
                list.Add(GridLength.Absolute(mm));
            }
        }
        return list;
    }
}
