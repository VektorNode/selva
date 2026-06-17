using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Layout;
using Selva.GH.Features.Drawing.Components;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.OBSOLETE;

/// <summary>
///     Obsolete Grid component (until v0.13.0). Replaced by the version whose Columns / Rows
///     are number lists (+mm / 0 = Auto / -weight = Star) instead of the "40 auto 1*" track DSL.
/// </summary>
public class OBSOLETE_Grid_UntilV0_13_0 : GH_Component
{
    public OBSOLETE_Grid_UntilV0_13_0()
        : base("Grid", "Grid",
            "Flex grid with absolute / auto / star tracks. Track DSL: \"40 auto 1* 2*\".",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.Grid;
    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("B4000A10-9152-4EDF-AB1E-C0D69F30D660");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Columns", "C", "Column-track DSL: space-separated <mm>|auto|<weight>* (e.g. \"40 auto 1*\"). Leave empty to auto-derive auto tracks from the cell column indices.", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Rows", "R", "Row-track DSL — same syntax as Columns. Leave empty to auto-derive auto tracks from the cell row indices.", GH_ParamAccess.item, "");
        pManager.AddGenericParameter("Drawings", "Dwg", "Cell content (one drawing per cell). All branches are flattened into a single grid.", GH_ParamAccess.tree);
        pManager.AddIntegerParameter("Cell Rows", "Cr", "Row index per cell, 0-based (parallel to Drawings). Flattened in the same order as Drawings.", GH_ParamAccess.tree);
        pManager.AddIntegerParameter("Cell Columns", "Cc", "Column index per cell, 0-based (parallel to Drawings). Flattened in the same order as Drawings.", GH_ParamAccess.tree);
        pManager.AddNumberParameter("Column Spacing", "CS", "Spacing between columns in mm", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Row Spacing", "RS", "Spacing between rows in mm", GH_ParamAccess.item, 0.0);

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
        var columnsDsl = "";
        var rowsDsl = "";
        var colSpacing = 0.0;
        var rowSpacing = 0.0;

        DA.GetData(0, ref columnsDsl);
        DA.GetData(1, ref rowsDsl);
        if (!DA.GetDataTree<IGH_Goo>(2, out GH_Structure<IGH_Goo> childTree)) childTree = new GH_Structure<IGH_Goo>();
        if (!DA.GetDataTree<GH_Integer>(3, out GH_Structure<GH_Integer> rowTree)) rowTree = new GH_Structure<GH_Integer>();
        if (!DA.GetDataTree<GH_Integer>(4, out GH_Structure<GH_Integer> colTree)) colTree = new GH_Structure<GH_Integer>();
        DA.GetData(5, ref colSpacing);
        DA.GetData(6, ref rowSpacing);

        var children = new List<DrawElement>();
        var skipped = 0;
        foreach (var goo in childTree.AllData(true))
        {
            if (goo is GH_ObjectWrapper wrap && wrap.Value is DrawElement el) children.Add(el);
            else if (goo is DrawElement direct) children.Add(direct);
            else skipped++;
        }
        if (skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Skipped {skipped} input(s) that are not drawing elements");
        }
        var rows = rowTree.AllData(true).OfType<GH_Integer>().Select(g => g.Value).ToList();
        var cols = colTree.AllData(true).OfType<GH_Integer>().Select(g => g.Value).ToList();

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
        for (var i = 0; i < children.Count; i++)
        {
            if (rows[i] < 0)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Cell {i}: row index {rows[i]} cannot be negative");
                return;
            }
            if (cols[i] < 0)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Cell {i}: column index {cols[i]} cannot be negative");
                return;
            }
        }

        IReadOnlyList<GridLength> columnTracks;
        IReadOnlyList<GridLength> rowTracks;
        try
        {
            columnTracks = string.IsNullOrWhiteSpace(columnsDsl)
                ? AutoTracks(cols.Max() + 1)
                : TrackDsl.Parse(columnsDsl, "Columns");
            rowTracks = string.IsNullOrWhiteSpace(rowsDsl)
                ? AutoTracks(rows.Max() + 1)
                : TrackDsl.Parse(rowsDsl, "Rows");
        }
        catch (FormatException ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            return;
        }

        if (rowTracks.Count == 0 || columnTracks.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                "Columns and Rows DSL must each declare at least one track");
            return;
        }

        var cells = new List<GridCell>(children.Count);
        for (var i = 0; i < children.Count; i++)
        {
            if (rows[i] >= rowTracks.Count)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                    $"Cell {i}: row index {rows[i]} is outside [0, {rowTracks.Count - 1}]");
                return;
            }
            if (cols[i] >= columnTracks.Count)
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
        };

        foreach (var ov in grid.ComputeOverflows(new LayoutContext(BoundingBox.Empty)))
        {
            var axis = ov.OverflowsWidth && ov.OverflowsHeight
                ? $"{ov.ContentWidth:0.##}×{ov.ContentHeight:0.##}mm content vs {ov.CellWidth:0.##}×{ov.CellHeight:0.##}mm cell"
                : ov.OverflowsWidth
                    ? $"{ov.ContentWidth:0.##}mm content vs {ov.CellWidth:0.##}mm cell width"
                    : $"{ov.ContentHeight:0.##}mm content vs {ov.CellHeight:0.##}mm cell height";
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Cell {ov.CellIndex} [row {ov.Row}, col {ov.Column}] overflows: {axis}");
        }

        DA.SetData(0, grid);
    }

    private static IReadOnlyList<GridLength> AutoTracks(int count)
    {
        var list = new List<GridLength>(count);
        for (var i = 0; i < count; i++) list.Add(GridLength.Auto);
        return list;
    }
}
