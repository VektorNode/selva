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

// Every field accepts a literal or a {token} resolved from the Document's Info values, so
// the same block wired into many Grasshopper files renders each file's own data.
public class GH_TitleBlock : GH_Component
{
    public GH_TitleBlock()
        : base("Title Block", "Title",
            "ISO 7200 title block with token-resolved fields and an optional logo. Wire into a Layout Override Footer.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.TitleBlock;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
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
        pManager.AddGenericParameter("Logo", "L", "Optional logo from a Draw Image component — placed top-left, aspect preserved, clipped to its cell so it never overlaps the owner/project text. Ignored on the Continuation variant.", GH_ParamAccess.item);
        pManager.AddNumberParameter("Logo Max W", "LW", "Max logo width in mm. 0 = bounded only by the logo cell. Aspect is always preserved.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Logo Max H", "LH", "Max logo height in mm. 0 = the logo-row height. Aspect is always preserved.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Width", "W", "Block width in mm. 0 = Auto (stretches to the page's content width, capped at 420mm). Positive = fixed width.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Height", "H", "Block height in mm. 0 = the variant's default (Full 50mm, Continuation 12mm).", GH_ParamAccess.item, 0.0);
        pManager.AddIntegerParameter("Labels", "Lb", "Language of the printed field captions (PROJECT / DRAWING NO. … vs PROJEKT / ZEICHNUNGS-NR. …). Independent of the Document's date Culture.", GH_ParamAccess.item, 0);

        for (var i = 0; i < 17; i++) pManager[i].Optional = true;

        if (pManager[0] is Param_Integer variant)
        {
            variant.AddNamedValue("Full", 0);
            variant.AddNamedValue("Continuation", 1);
        }

        if (pManager[16] is Param_Integer labels)
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
        var logoMaxW = 0.0;
        var logoMaxH = 0.0;
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
        DA.GetData(12, ref logoMaxW);
        DA.GetData(13, ref logoMaxH);
        DA.GetData(14, ref width);
        DA.GetData(15, ref height);
        DA.GetData(16, ref labelsIndex);

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

        // Width 0 → Auto: 180mm is a fallback for when the band width is unknown; the renderer
        // stretches the block to the page's content width instead (capped at MaxAutoWidth).
        var autoWidth = width <= 0;
        var w = width > 0 ? width : 180.0;
        var size = new BBox(0, 0, w, h);

        var block = isContinuation
            ? TitleBlock.Continuation(values, size, labels)
            : TitleBlock.Iso7200(values, size, labels);

        block = WithSettings(block, size, autoWidth, isContinuation ? null : ExtractLogo(logo),
            logoMaxW, logoMaxH);

        DA.SetData(0, block);
    }

    // Layers the GH-driven settings onto the factory-produced block (factory helpers only set Rows + Size).
    private static TitleBlock WithSettings(TitleBlock block, BBox size, bool autoWidth, ImageElement logo,
        double logoMaxW, double logoMaxH)
    {
        return new TitleBlock
        {
            Rows = block.Rows,
            Size = size,
            AutoWidth = autoWidth,
            Logo = logo,
            LogoMaxWidth = logoMaxW,
            LogoMaxHeight = logoMaxH,
            Border = block.Border,
            InnerBorder = block.InnerBorder,
            LabelStyle = block.LabelStyle,
            ValueStyle = block.ValueStyle,
            CellPadding = block.CellPadding,
            Origin = block.Origin,
        };
    }

    // SVGs resolve to a GroupElement of geometry, which the raster-only logo slot can't place.
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
