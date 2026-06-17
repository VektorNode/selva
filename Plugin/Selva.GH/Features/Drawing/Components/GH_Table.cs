using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Properties;
using DrawColor = Selva.Drawing.Model.Style.Color;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: tabular data layout with optional header row, a column-width
// number list, and built-in borders/cell padding. Body cells arrive as a data tree where
// each branch is one row and each item in the branch is a cell value (text). Column widths
// use the same convention as Grid: >0 = mm, 0 = auto, <0 = star weight.
public class GH_Table : GH_Component
{
    public GH_Table()
        : base("Table", "Table",
            "Tabular layout with header, borders, and cell padding. Rows are a data tree (one branch per row).",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.Table;
    public override GH_Exposure Exposure => GH_Exposure.quinary;
    public override Guid ComponentGuid => new Guid("2B7C8D3E-4F5A-4B6C-8D9E-1F2A3B4C5D62");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Headers", "H", "Optional header row", GH_ParamAccess.list);
        pManager.AddTextParameter("Rows", "R", "Body rows — supply as a data tree, one branch per row", GH_ParamAccess.tree);
        pManager.AddNumberParameter("Column Widths", "CW", "Column widths, one number per column: >0 = fixed mm, 0 = auto (fit content), <0 = star track (weight = abs). Empty → all columns are equal star tracks.", GH_ParamAccess.list);
        pManager.AddNumberParameter("Row Height", "RH", "Fixed row height in mm (0 = auto-size)", GH_ParamAccess.item, 0.0);
        pManager.AddParameter(new Param_Stroke("Border", "B", "Border stroke (use Path Style component; leave empty for none)", "Selva", "Layout", GH_ParamAccess.item));
        pManager.AddParameter(new Param_TextStyle("Default Style", "S", "Default cell text style (use Text Style component; leave empty for default)", "Selva", "Layout", GH_ParamAccess.item));
        pManager.AddParameter(new Param_TextStyle("Header Style", "HS", "Header cell text style (leave empty to inherit default style with bold weight)", "Selva", "Layout", GH_ParamAccess.item));
        pManager.AddColourParameter("Header Color", "HC", "Header row background color (RGBA supported; leave empty for none)", GH_ParamAccess.item);
        pManager.AddTextParameter("Column Align", "CA", "Per-column text alignment, one item per column. Accepts \"left\"/\"l\", \"center\"/\"c\", \"right\"/\"r\". Empty = left for all.", GH_ParamAccess.list);
        pManager.AddIntegerParameter("Border Style", "BS", "Which borders to draw", GH_ParamAccess.item, 0);
        pManager.AddColourParameter("Row Colors", "RC", "Body row background colors (RGBA supported). Cycles per row: 1 color = solid, 2 = alternating, N = N-row cycle. Empty = no row fills.", GH_ParamAccess.list);

        pManager[0].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
        pManager[7].Optional = true;
        pManager[8].Optional = true;
        pManager[9].Optional = true;
        pManager[10].Optional = true;

        if (pManager[9] is Param_Integer borderStyleParam)
        {
            borderStyleParam.AddNamedValue("All", 0);
            borderStyleParam.AddNamedValue("Horizontal", 1);
            borderStyleParam.AddNamedValue("Header", 2);
            borderStyleParam.AddNamedValue("Outer", 3);
            borderStyleParam.AddNamedValue("None", 4);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var headers = new List<string>();
        var columnSizes = new List<double>();
        var rowHeight = 0.0;
        Stroke border = null;
        TextStyle style = null;
        TextStyle headerStyle = null;
        System.Drawing.Color? headerColor = null;
        var alignTokens = new List<string>();
        var borderStyleIndex = 0;
        var rowColors = new List<System.Drawing.Color>();

        DA.GetDataList(0, headers);
        if (!DA.GetDataTree(1, out GH_Structure<GH_String> rowTree))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No rows provided");
            return;
        }
        DA.GetDataList(2, columnSizes);
        DA.GetData(3, ref rowHeight);
        DA.GetData(4, ref border);
        DA.GetData(5, ref style);
        DA.GetData(6, ref headerStyle);
        var headerColorValue = System.Drawing.Color.Empty;
        if (DA.GetData(7, ref headerColorValue)) headerColor = headerColorValue;
        DA.GetDataList(8, alignTokens);
        DA.GetData(9, ref borderStyleIndex);
        DA.GetDataList(10, rowColors);

        Fill headerFill = headerColor.HasValue ? ToFill(headerColor.Value) : null;
        IReadOnlyList<Fill> rowStripeFills = null;
        if (rowColors.Count > 0)
        {
            var fills = new Fill[rowColors.Count];
            for (var i = 0; i < rowColors.Count; i++) fills[i] = ToFill(rowColors[i]);
            rowStripeFills = fills;
        }

        var bodyRows = new List<IReadOnlyList<TableCell>>(rowTree.PathCount);
        foreach (var path in rowTree.Paths)
        {
            var branch = rowTree.get_Branch(path);
            var row = new List<TableCell>(branch.Count);
            foreach (var item in branch)
            {
                var s = item is GH_String gs ? gs.Value : item?.ToString();
                row.Add(new TableCell { Text = s ?? string.Empty });
            }
            bodyRows.Add(row);
        }

        IReadOnlyList<TableCell> headerRow = null;
        if (headers.Count > 0)
        {
            var hCells = new TableCell[headers.Count];
            for (var i = 0; i < headers.Count; i++) hCells[i] = new TableCell { Text = headers[i] ?? "" };
            headerRow = hCells;
        }

        IReadOnlyList<TextAnchor> columnAlignments = null;
        if (alignTokens.Count > 0)
        {
            var anchors = new TextAnchor[alignTokens.Count];
            for (var i = 0; i < alignTokens.Count; i++) anchors[i] = ParseAnchor(alignTokens[i]);
            columnAlignments = anchors;
        }

        var resolvedBorderStyle = (TableBorderStyle)Math.Max(0, Math.Min(4, borderStyleIndex));

        IReadOnlyList<GridLength> columnWidths = columnSizes.Count > 0
            ? TrackSizes.FromNumbers(columnSizes)
            : null;

        WarnOnCountMismatch(headers, bodyRows, columnWidths, alignTokens);

        var table = new Table
        {
            Header = headerRow,
            Rows = bodyRows,
            ColumnWidths = columnWidths,
            ColumnAlignments = columnAlignments,
            RowHeight = rowHeight > 0 ? (double?)rowHeight : null,
            Border = border ?? new Stroke { Width = 0.25 },
            BorderStyle = resolvedBorderStyle,
            DefaultCellStyle = style ?? new TextStyle(),
            HeaderStyle = headerStyle,
            HeaderBackground = headerFill,
            RowStripeFills = rowStripeFills,
        };

        DA.SetData(0, table);
    }

    // Mismatched counts render with blank/ignored cells, which reads as "the table is
    // broken" with no hint — surface a remark so users see why columns look off.
    private void WarnOnCountMismatch(
        List<string> headers,
        List<IReadOnlyList<TableCell>> bodyRows,
        IReadOnlyList<GridLength> columnWidths,
        List<string> alignTokens)
    {
        var bodyColumns = 0;
        foreach (var row in bodyRows)
            if (row.Count > bodyColumns) bodyColumns = row.Count;
        if (bodyColumns == 0) return;

        if (headers.Count > 0 && headers.Count != bodyColumns)
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"Headers has {headers.Count} item(s) but the widest body row has {bodyColumns} — extra columns render blank");
        if (columnWidths != null && columnWidths.Count != bodyColumns)
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"Column Widths declares {columnWidths.Count} track(s) but the widest body row has {bodyColumns} column(s)");
        if (alignTokens.Count > 0 && alignTokens.Count < bodyColumns)
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"Column Align has {alignTokens.Count} item(s) for {bodyColumns} column(s) — remaining columns fall back to left");
    }

    private static Fill ToFill(System.Drawing.Color c) => new Fill
    {
        Color = DrawColor.Rgb(c.R, c.G, c.B, c.A),
    };

    private static TextAnchor ParseAnchor(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) return TextAnchor.Left;
        switch (token.Trim().ToLowerInvariant())
        {
            case "c":
            case "center":
            case "centre":
            case "middle":
            case "m":
                return TextAnchor.Center;
            case "r":
            case "right":
            case "end":
                return TextAnchor.Right;
            default:
                return TextAnchor.Left;
        }
    }

}
