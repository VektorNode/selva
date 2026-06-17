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
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: a flex grid where columns and rows are sized by a number list —
// each value is > 0 (fixed drawing units), 0 (auto, fit content), or < 0 (star track, weight = abs).
// Track sizes come from Column Widths + Row Heights; cell placement comes from the parallel
// At Row + At Column lists. When both placement lists are empty, drawings auto-flow
// left-to-right, top-to-bottom across the column count — the common case needs no index
// wiring at all.
public class GH_Grid : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_Grid()
        : base("Grid", "Grid",
            "Flex grid with fixed / auto / star tracks. Size columns and rows with a number list: >0 = fixed (drawing units), 0 = auto, <0 = star weight.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.Grid;
    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("1A6B7C2D-3E4F-4A5B-9C8D-7E6F5A4B3C21");

    public override bool IsPreviewCapable => true;
    public override Rhino.Geometry.BoundingBox ClippingBox => _preview.ClippingBox;

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
        pManager.AddNumberParameter("Column Widths", "CW", "Column widths, one number per column: >0 = fixed (drawing units), 0 = auto (fit content), <0 = star track (shares leftover space, weight = abs). Leave empty to auto-derive from the cell positions.", GH_ParamAccess.list);
        pManager.AddNumberParameter("Row Heights", "RH", "Row heights — same convention as Column Widths: >0 = fixed (drawing units), 0 = auto, <0 = star. Leave empty to auto-derive from the cell positions.", GH_ParamAccess.list);
        pManager.AddGenericParameter("Drawings", "Dwg", "Cell content (one drawing per cell). All branches are flattened into a single grid.", GH_ParamAccess.tree);
        pManager.AddIntegerParameter("At Row", "AtR", "Row index for each drawing, 0-based (parallel to Drawings). Leave empty to auto-flow drawings across the columns (left-to-right, top-to-bottom). If set, 'At Column' must match.", GH_ParamAccess.tree);
        pManager.AddIntegerParameter("At Column", "AtC", "Column index for each drawing, 0-based (parallel to Drawings). Leave empty to auto-flow drawings across the columns (left-to-right, top-to-bottom). If set, 'At Row' must match.", GH_ParamAccess.tree);
        pManager.AddNumberParameter("Column Spacing", "CS", "Spacing between columns, in drawing units", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Row Spacing", "RS", "Spacing between rows, in drawing units", GH_ParamAccess.item, 0.0);
        pManager.AddIntegerParameter("Columns", "N", "How many columns to wrap the drawings into when auto-flowing (At Row / At Column left empty). E.g. 1 = one drawing per row (stacked), 2 = two per row. Ignored when explicit positions are given.", GH_ParamAccess.item, 0);

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var columnSizes = new List<double>();
        var rowSizes = new List<double>();
        var colSpacing = 0.0;
        var rowSpacing = 0.0;
        var autoColumns = 0;

        DA.GetDataList(0, columnSizes);
        DA.GetDataList(1, rowSizes);
        if (!DA.GetDataTree<IGH_Goo>(2, out GH_Structure<IGH_Goo> childTree)) childTree = new GH_Structure<IGH_Goo>();
        if (!DA.GetDataTree<GH_Integer>(3, out GH_Structure<GH_Integer> rowTree)) rowTree = new GH_Structure<GH_Integer>();
        if (!DA.GetDataTree<GH_Integer>(4, out GH_Structure<GH_Integer> colTree)) colTree = new GH_Structure<GH_Integer>();
        DA.GetData(5, ref colSpacing);
        DA.GetData(6, ref rowSpacing);
        DA.GetData(7, ref autoColumns);

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

        // Auto-flow: when no explicit indices are given, lay drawings out left-to-right,
        // top-to-bottom across the column count. The common "drop N drawings into a grid"
        // case then needs no index wiring at all.
        if (rows.Count == 0 && cols.Count == 0)
        {
            // Column count priority: explicit Columns input > Column Widths list length >
            // a roughly-square fallback.
            var autoCols = autoColumns > 0
                ? autoColumns
                : columnSizes.Count > 0
                    ? columnSizes.Count
                    : (int)Math.Ceiling(Math.Sqrt(children.Count));
            for (var i = 0; i < children.Count; i++)
            {
                rows.Add(i / autoCols);
                cols.Add(i % autoCols);
            }
        }
        else if (rows.Count != children.Count || cols.Count != children.Count)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                $"'At Row' ({rows.Count}) and 'At Column' ({cols.Count}) must each match the drawing count ({children.Count}), or leave both empty to auto-flow.");
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

        // Empty list → auto-derive `auto` tracks from cell indices. Lets users skip sizing
        // entirely for the common case of "N children at these (row, col) positions".
        var columnTracks = columnSizes.Count == 0
            ? AutoTracks(cols.Max() + 1)
            : TrackSizes.FromNumbers(columnSizes);
        var rowTracks = rowSizes.Count == 0
            ? AutoTracks(rows.Max() + 1)
            : TrackSizes.FromNumbers(rowSizes);

        if (rowTracks.Count == 0 || columnTracks.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                "Columns and Rows must each declare at least one track");
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

        // Surface absolute-track overflows as warnings. Star/auto overflows depend on the
        // parent layout context (page width, etc.) so they can only be reported here when
        // an absolute cell is too small for its content.
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

        // Viewport overlay: Grid.Resolve embeds PreviewOnly cell-divider boxes in the
        // resolved tree, so previewing the resolved element shows both content and grid
        // lines — and the same guides appear downstream (Page/Document) for free.
        //
        // Resolve once with an empty context to learn the grid's natural extent, then feed
        // that extent back as the available context so star/auto tracks expand to the grid's
        // own bounds and the dividers land at their real positions (an infinite-available
        // context collapses star tracks onto their content).
        var natural = grid.ComputeBounds();
        var ctx = natural.IsEmpty
            ? new LayoutContext(BoundingBox.Empty)
            : new LayoutContext(new BoundingBox(0, 0, natural.Width, natural.Height));
        _preview.Add(grid.Resolve(ctx));

        DA.SetData(0, grid);
    }

    private static IReadOnlyList<GridLength> AutoTracks(int count)
    {
        var list = new List<GridLength>(count);
        for (var i = 0; i < count; i++) list.Add(GridLength.Auto);
        return list;
    }

}
