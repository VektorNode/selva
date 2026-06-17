using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.GH.Properties;
using BBox = Selva.Drawing.Model.Geometry.BoundingBox;

namespace Selva.GH.Features.Drawing.Components;

// ISO 7200 drawing title block. Every field accepts a literal or a {token} that resolves from
// the Document's Info values — so the same block, wired into many Grasshopper files, renders
// each file's data. Two variants: Full (first sheet, all fields + optional logo) and
// Continuation (slim strip — drawing no. / title / rev / sheet — for later sheets).
//
// Width defaults to Auto (ISO rule, resolved from the document's paper at render time): full
// content width on A4-and-narrower sheets, fixed 180mm bottom-right corner on A3 and larger.
// Set Width to a positive number to override. Wire the output into a Layout Override's Footer.
public class GH_TitleBlock : GH_Component
{
    public GH_TitleBlock()
        : base("Title Block", "Title",
            "ISO 7200 title block with token-resolved fields and an optional logo. Wire into a Layout Override Footer.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.TitleBlock;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("A2501A92-E5D1-4646-A3D0-4368CE879BFC");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddIntegerParameter("Variant", "V", "Full = first sheet (all fields + logo). Continuation = slim strip (drawing no. / title / rev / sheet) for later sheets.", GH_ParamAccess.item, 0);
        pManager.AddTextParameter("Project", "Pr", "Project name (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Owner", "Ow", "Legal owner / client (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Title", "T", "Drawing title (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Drawing No", "D", "Drawing number (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Revision", "R", "Revision tag (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Scale", "S", "Drawing scale (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Sheet", "Sh", "Sheet number, e.g. \"{page}/{pages}\"", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Created By", "A", "Drafter name/initials (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Approved By", "Ap", "Approver name/initials (or {token})", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Date", "Dt", "Date of issue, e.g. \"{date}\"", GH_ParamAccess.item, "");
        pManager.AddGenericParameter("Logo", "L", "Optional logo from a Draw Image component — placed top-left, aspect preserved. Ignored on the Continuation variant.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Width", "W", "Block width in mm. 0 = Auto (ISO rule from the document's paper). Positive = fixed width.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Height", "H", "Block height in mm. 0 = the variant's default (Full 50mm, Continuation 12mm).", GH_ParamAccess.item, 0.0);
        pManager.AddIntegerParameter("Labels", "Lb", "Language of the printed field captions (PROJECT / DRAWING NO. … vs PROJEKT / ZEICHNUNGS-NR. …). Independent of the Document's date Culture.", GH_ParamAccess.item, 0);

        for (var i = 0; i < 15; i++) pManager[i].Optional = true;

        if (pManager[0] is Param_Integer variant)
        {
            variant.AddNamedValue("Full", 0);
            variant.AddNamedValue("Continuation", 1);
        }

        if (pManager[14] is Param_Integer labels)
        {
            labels.AddNamedValue("English", 0);
            labels.AddNamedValue("Deutsch", 1);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Title block element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var variant = 0;
        string project = "", owner = "", title = "", drawingNo = "", revision = "",
            scale = "", sheet = "", author = "", approver = "", date = "";
        DrawElement logo = null;
        var width = 0.0;
        var height = 0.0;
        var labelsIndex = 0;

        DA.GetData(0, ref variant);
        DA.GetData(1, ref project);
        DA.GetData(2, ref owner);
        DA.GetData(3, ref title);
        DA.GetData(4, ref drawingNo);
        DA.GetData(5, ref revision);
        DA.GetData(6, ref scale);
        DA.GetData(7, ref sheet);
        DA.GetData(8, ref author);
        DA.GetData(9, ref approver);
        DA.GetData(10, ref date);
        DA.GetData(11, ref logo);
        DA.GetData(12, ref width);
        DA.GetData(13, ref height);
        DA.GetData(14, ref labelsIndex);

        var isContinuation = variant == 1;
        var labels = labelsIndex == 1 ? TitleBlockLabels.German : TitleBlockLabels.English;

        var values = new Dictionary<string, string>
        {
            ["Project"] = project ?? "",
            ["Owner"] = owner ?? "",
            ["Title"] = title ?? "",
            ["DrawingNumber"] = drawingNo ?? "",
            ["Revision"] = revision ?? "",
            ["Scale"] = scale ?? "",
            ["Sheet"] = sheet ?? "",
            ["Author"] = author ?? "",
            ["Approver"] = approver ?? "",
            ["Date"] = date ?? "",
        };

        var defaultHeight = isContinuation ? 12.0 : 50.0;
        var h = height > 0 ? height : defaultHeight;

        // Width 0 → Auto: keep the 180mm fixed size as the corner-block fallback and flag the
        // block so the renderer stretches it to A4-narrow bands per ISO 7200. A positive width
        // pins an explicit size and disables the auto rule.
        var autoWidth = width <= 0;
        var w = width > 0 ? width : 180.0;
        var size = new BBox(0, 0, w, h);

        var block = isContinuation
            ? TitleBlock.Continuation(values, size, labels)
            : TitleBlock.Iso7200(values, size, labels);

        block = WithSettings(block, size, autoWidth, isContinuation ? null : ExtractLogo(logo));

        DA.SetData(0, block);
    }

    // Apply the resolved size / auto-width flag / logo onto the factory-produced block. The
    // factory helpers set Rows + Size; this layers the GH-driven settings on top.
    private static TitleBlock WithSettings(TitleBlock block, BBox size, bool autoWidth, ImageElement logo)
    {
        return new TitleBlock
        {
            Rows = block.Rows,
            Size = size,
            AutoWidth = autoWidth,
            Logo = logo,
            Border = block.Border,
            InnerBorder = block.InnerBorder,
            LabelStyle = block.LabelStyle,
            ValueStyle = block.ValueStyle,
            CellPadding = block.CellPadding,
            Origin = block.Origin,
        };
    }

    // The Logo input takes the output of a Draw Image component. Raster images resolve to an
    // ImageElement directly; SVGs resolve to a GroupElement of geometry, which the title block's
    // raster-only logo slot can't place — warn and skip those.
    private ImageElement ExtractLogo(DrawElement logo)
    {
        switch (logo)
        {
            case null:
                return null;
            case ImageElement img:
                return img;
            default:
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    "Logo must be a raster image (PNG/JPEG/WEBP) from a Draw Image component — vector SVG logos aren't supported in the title block. Ignoring.");
                return null;
        }
    }
}
