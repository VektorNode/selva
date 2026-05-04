using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model.Layout;
using Selva.Drawing.Model.Style;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Phase 7 layout component: tabular data layout with optional header row, column-track DSL,
// and built-in borders/cell padding. Body cells arrive as a data tree where each branch is
// one row and each item in the branch is a cell value (text). Mirrors Grid's track DSL —
// "40 auto 1*" — for ColumnWidths.
public class GH_Table : GH_Component
{
    public GH_Table()
        : base("Table", "Table",
            "Tabular layout with header, borders, and cell padding. Rows are a data tree (one branch per row).",
            "Selva", "Layout")
    {
    }

    protected override Bitmap Icon => Resources.Table;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("7CAE0062-0CC4-4D3E-ACE9-EE874D00C6BD");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Headers", "H", "Optional header row", GH_ParamAccess.list);
        pManager.AddTextParameter("Rows", "R", "Body rows — supply as a data tree, one branch per row", GH_ParamAccess.tree);
        pManager.AddTextParameter("Column Widths", "CW", "Track DSL: \"40 auto 1*\". Empty → all columns are 1*.", GH_ParamAccess.item, "");
        pManager.AddNumberParameter("Row Height", "RH", "Fixed row height in mm (0 = auto-size)", GH_ParamAccess.item, 0.0);
        pManager.AddGenericParameter("Border", "B", "Stroke style for borders (leave empty for none)", GH_ParamAccess.item);
        pManager.AddGenericParameter("Default Style", "S", "Default text style for cells (leave empty for default)", GH_ParamAccess.item);
        pManager.AddGenericParameter("Header Style", "HS", "Text style for header cells (leave empty to inherit default style with bold weight)", GH_ParamAccess.item);
        pManager.AddGenericParameter("Header Fill", "HF", "Background fill for the header row (leave empty for none)", GH_ParamAccess.item);

        pManager[0].Optional = true;
        pManager[2].Optional = true;
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
        var headers = new List<string>();
        var columnsDsl = "";
        var rowHeight = 0.0;
        Stroke border = null;
        TextStyle style = null;
        TextStyle headerStyle = null;
        Fill headerFill = null;

        DA.GetDataList(0, headers);
        if (!DA.GetDataTree(1, out GH_Structure<GH_String> rowTree))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No rows provided");
            return;
        }
        DA.GetData(2, ref columnsDsl);
        DA.GetData(3, ref rowHeight);
        DA.GetData(4, ref border);
        DA.GetData(5, ref style);
        DA.GetData(6, ref headerStyle);
        DA.GetData(7, ref headerFill);

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

        var table = new Table
        {
            Header = headerRow,
            Rows = bodyRows,
            ColumnWidths = string.IsNullOrWhiteSpace(columnsDsl) ? null : ParseTracks(columnsDsl),
            RowHeight = rowHeight > 0 ? (double?)rowHeight : null,
            Border = border ?? new Stroke { Width = 0.25 },
            DefaultCellStyle = style ?? new TextStyle(),
            HeaderStyle = headerStyle,
            HeaderBackground = headerFill,
        };

        DA.SetData(0, table);
    }

    private static IReadOnlyList<GridLength> ParseTracks(string dsl)
    {
        // Reuses the same DSL as GH_Grid. Kept inline to avoid taking a public dependency.
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
                    : double.Parse(w, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture);
                list.Add(GridLength.Star(weight));
            }
            else
            {
                var mm = double.Parse(t, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture);
                list.Add(GridLength.Absolute(mm));
            }
        }
        return list;
    }
}
