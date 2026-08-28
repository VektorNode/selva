using System;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Layout;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// Bundles optional layout overrides (paper, margins, chrome) into a value that plugs into a
// Document or Page Override input. On a Document it sets the defaults; on a Page it overrides
// those defaults for that section's pages only.
//
// Every input is optional: leave a field at its inherit sentinel (-1 for ints/doubles, no
// connection for chrome elements) and it falls back to the Document's default, or the built-in
// default at Document scope.
public class GH_LayoutOverride : GH_Component
{
    public GH_LayoutOverride()
        : base("Layout Override", "LOver",
            "Optional layout overrides for paper, margins, and chrome. Wire into a Document or Page Override input.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.SectionSettings;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("3F5F0E10-2A21-4F0E-9F25-7B0F2C7C5E91");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddIntegerParameter("Paper Size", "PS", "Paper size for this section. -1 inherits the document's paper size.", GH_ParamAccess.item, -1);
        pManager.AddBooleanParameter("Landscape", "L", "Rotate the overridden paper to landscape. Ignored when Paper Size is set to Inherit.", GH_ParamAccess.item, false);
        pManager.AddNumberParameter("Margin", "M", "Uniform page margin in millimetres. -1 inherits the document's margin.", GH_ParamAccess.item, -1.0);
        pManager.AddGenericParameter("Header", "H", "Optional override of the document header for this section's pages.", GH_ParamAccess.item);
        pManager.AddGenericParameter("Footer", "F", "Optional override of the document footer for this section's pages.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Header Height", "HH", "Reserved header height in mm. -1 = Auto. 0 = no reservation.", GH_ParamAccess.item, -1.0);
        pManager.AddNumberParameter("Footer Height", "FH", "Reserved footer height in mm. -1 = Auto. 0 = no reservation.", GH_ParamAccess.item, -1.0);
        pManager.AddIntegerParameter("Header Align", "HA", "Horizontal alignment of the header within its band. -1 inherits the document's value.", GH_ParamAccess.item, -1);
        pManager.AddIntegerParameter("Footer Align", "FA", "Horizontal alignment of the footer within its band. -1 inherits the document's value.", GH_ParamAccess.item, -1);
        pManager.AddIntegerParameter("Header Placement", "HP", "Where the header band lives. -1 inherits.", GH_ParamAccess.item, -1);
        pManager.AddIntegerParameter("Footer Placement", "FP", "Where the footer band lives. -1 inherits.", GH_ParamAccess.item, -1);
        pManager.AddNumberParameter("Header Edge Offset", "HEO", "Distance in mm from the top of the paper to the top of the header band when Header Placement is Edge. -1 inherits.", GH_ParamAccess.item, -1.0);
        pManager.AddNumberParameter("Footer Edge Offset", "FEO", "Distance from the bottom of the paper to the bottom of the footer band when Footer Placement is Edge, in document units. -1 inherits.", GH_ParamAccess.item, -1.0);
        pManager.AddIntegerParameter("Units", "U", "Unit that Margin and the Header/Footer height + offset inputs are authored in. Auto = the active Rhino document's unit. Paper sizes are physical and fixed regardless.", GH_ParamAccess.item, DrawingUnits.Auto);

        for (var i = 0; i < 14; i++) pManager[i].Optional = true;

        if (pManager[0] is Param_Integer paperParam)
        {
            paperParam.AddNamedValue("Inherit", -1);
            paperParam.AddNamedValue("A0", 0);
            paperParam.AddNamedValue("A1", 1);
            paperParam.AddNamedValue("A2", 2);
            paperParam.AddNamedValue("A3", 3);
            paperParam.AddNamedValue("A4", 4);
            paperParam.AddNamedValue("A5", 5);
            paperParam.AddNamedValue("Letter", 6);
            paperParam.AddNamedValue("Legal", 7);
            paperParam.AddNamedValue("Tabloid", 8);
            paperParam.AddNamedValue("ANSI A", 9);
            paperParam.AddNamedValue("ANSI B", 10);
            paperParam.AddNamedValue("ANSI C", 11);
            paperParam.AddNamedValue("ANSI D", 12);
            paperParam.AddNamedValue("ANSI E", 13);
            paperParam.AddNamedValue("ARCH A", 14);
            paperParam.AddNamedValue("ARCH B", 15);
            paperParam.AddNamedValue("ARCH C", 16);
            paperParam.AddNamedValue("ARCH D", 17);
            paperParam.AddNamedValue("ARCH E", 18);
        }
        if (pManager[13] is Param_Integer unitsParam)
            DrawingUnits.AddNamedValues(unitsParam);
        if (pManager[7] is Param_Integer headerAlign)
        {
            headerAlign.AddNamedValue("Inherit", -1);
            headerAlign.AddNamedValue("Left", 0);
            headerAlign.AddNamedValue("Center", 1);
            headerAlign.AddNamedValue("Right", 2);
        }
        if (pManager[8] is Param_Integer footerAlign)
        {
            footerAlign.AddNamedValue("Inherit", -1);
            footerAlign.AddNamedValue("Left", 0);
            footerAlign.AddNamedValue("Center", 1);
            footerAlign.AddNamedValue("Right", 2);
        }
        if (pManager[9] is Param_Integer headerPlacement)
        {
            headerPlacement.AddNamedValue("Inherit", -1);
            headerPlacement.AddNamedValue("Margin", 0);
            headerPlacement.AddNamedValue("Content", 1);
            headerPlacement.AddNamedValue("Edge", 2);
        }
        if (pManager[10] is Param_Integer footerPlacement)
        {
            footerPlacement.AddNamedValue("Inherit", -1);
            footerPlacement.AddNamedValue("Margin", 0);
            footerPlacement.AddNamedValue("Content", 1);
            footerPlacement.AddNamedValue("Edge", 2);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Override", "O", "Layout override to plug into a Document or Page", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var paperIndex = -1;
        var landscape = false;
        var margin = -1.0;
        DrawElement header = null;
        DrawElement footer = null;
        var headerHeight = -1.0;
        var footerHeight = -1.0;
        var headerAlignIndex = -1;
        var footerAlignIndex = -1;
        var headerPlacementIndex = -1;
        var footerPlacementIndex = -1;
        var headerEdgeOffset = -1.0;
        var footerEdgeOffset = -1.0;
        var unitsIndex = 0;

        DA.GetData(0, ref paperIndex);
        DA.GetData(1, ref landscape);
        DA.GetData(2, ref margin);
        DA.GetData(3, ref header);
        DA.GetData(4, ref footer);
        DA.GetData(5, ref headerHeight);
        DA.GetData(6, ref footerHeight);
        DA.GetData(7, ref headerAlignIndex);
        DA.GetData(8, ref footerAlignIndex);
        DA.GetData(9, ref headerPlacementIndex);
        DA.GetData(10, ref footerPlacementIndex);
        DA.GetData(11, ref headerEdgeOffset);
        DA.GetData(12, ref footerEdgeOffset);
        DA.GetData(13, ref unitsIndex);

        var mmPerUnit = DrawingUnits.MmPerUnit(unitsIndex);

        PaperSize? paperOverride = null;
        if (paperIndex >= 0)
        {
            if (paperIndex > 18)
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"Paper Size {paperIndex} is out of range (0=A0 … 18=ARCH E) — falling back to A4");
            var p = ResolvePaper(paperIndex);
            paperOverride = landscape ? p.Landscape() : p;
        }
        else if (landscape)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                "Landscape is ignored while Paper Size is Inherit — set a paper size to apply it");
        }

        var ov = new LayoutOverride
        {
            PaperSize = paperOverride,
            Margins = margin >= 0 ? Margins.Uniform(margin * mmPerUnit) : null,
            Header = header,
            Footer = footer,
            HeaderHeight = ResolveBandHeight(headerHeight, mmPerUnit),
            FooterHeight = ResolveBandHeight(footerHeight, mmPerUnit),
            HeaderAlign = ResolveAlign(headerAlignIndex),
            FooterAlign = ResolveAlign(footerAlignIndex),
            HeaderPlacement = ResolvePlacement(headerPlacementIndex),
            FooterPlacement = ResolvePlacement(footerPlacementIndex),
            HeaderEdgeOffset = headerEdgeOffset >= 0 ? headerEdgeOffset * mmPerUnit : (double?)null,
            FooterEdgeOffset = footerEdgeOffset >= 0 ? footerEdgeOffset * mmPerUnit : (double?)null,
        };

        DA.SetData(0, ov);
    }

    private static double? ResolveBandHeight(double input, double mmPerUnit)
    {
        if (input < 0) return null;
        if (input == 0) return 0.0;
        return input * mmPerUnit;
    }

    private static HorizontalAlign? ResolveAlign(int i) => i switch
    {
        0 => HorizontalAlign.Left,
        1 => HorizontalAlign.Center,
        2 => HorizontalAlign.Right,
        _ => null,
    };

    private static ChromePlacement? ResolvePlacement(int i) => i switch
    {
        0 => ChromePlacement.Margin,
        1 => ChromePlacement.Content,
        2 => ChromePlacement.Edge,
        _ => null,
    };

    private static PaperSize ResolvePaper(int i) => i switch
    {
        0 => PaperSize.A0,
        1 => PaperSize.A1,
        2 => PaperSize.A2,
        3 => PaperSize.A3,
        5 => PaperSize.A5,
        6 => PaperSize.Letter,
        7 => PaperSize.Legal,
        8 => PaperSize.Tabloid,
        9 => PaperSize.AnsiA,
        10 => PaperSize.AnsiB,
        11 => PaperSize.AnsiC,
        12 => PaperSize.AnsiD,
        13 => PaperSize.AnsiE,
        14 => PaperSize.ArchA,
        15 => PaperSize.ArchB,
        16 => PaperSize.ArchC,
        17 => PaperSize.ArchD,
        18 => PaperSize.ArchE,
        _ => PaperSize.A4,
    };
}
