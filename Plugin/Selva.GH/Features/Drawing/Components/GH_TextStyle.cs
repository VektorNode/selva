using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Parameters;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Goos;
using Selva.GH.Features.Drawing.Params;
using Selva.GH.Properties;
using Selva.GH.Utilities;
using Color = System.Drawing.Color;
using ModelColor = Selva.Drawing.Model.Style.Color;
using ModelFontStyle = Selva.Drawing.Model.Style.FontStyle;

namespace Selva.GH.Features.Drawing.Components;

public class GH_TextStyle : SelvaZuiComponent
{
    public GH_TextStyle()
        : base("Text Style", "TStyle",
            "Creates a text style for drawing labels, table cells, leader text, etc.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.PathStlye;
    public override GH_Exposure Exposure => GH_Exposure.tertiary;
    public override Guid ComponentGuid => new Guid("6D5CCE51-0B0D-4936-B076-E7D0DD1B820D");

    protected override IReadOnlyCollection<string> PrimaryInputs =>
        new[] { "Font Family", "Font Size", "Color", "Weight", "Horizontal Anchor" };

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Font Family", "F", "Font family name (e.g. \"Inter\", \"Arial\")", GH_ParamAccess.item, "Inter");
        pManager.AddNumberParameter("Font Size", "S", "Font size in drawing units (mm)", GH_ParamAccess.item, 2.5);
        pManager.AddColourParameter("Color", "C", "Text color", GH_ParamAccess.item, Color.Black);
        pManager.AddIntegerParameter("Weight", "W", "Font weight", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Style", "St", "Font style", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Decoration", "D", "Text decoration", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Horizontal Anchor", "HA", "Horizontal text anchor", GH_ParamAccess.item, 0);
        pManager.AddIntegerParameter("Vertical Anchor", "VA", "Vertical text anchor", GH_ParamAccess.item, 2);
        pManager.AddNumberParameter("Line Height", "LH", "Line height multiplier (1.2 = 120% of font size)", GH_ParamAccess.item, 1.2);
        pManager.AddNumberParameter("Letter Spacing", "LS", "Letter spacing in drawing units (mm)", GH_ParamAccess.item, 0.0);

        for (var i = 0; i < 10; i++) pManager[i].Optional = true;

        if (pManager[3] is Param_Integer weightParam)
        {
            weightParam.AddNamedValue("Normal", 0);
            weightParam.AddNamedValue("Bold", 1);
        }

        if (pManager[4] is Param_Integer styleParam)
        {
            styleParam.AddNamedValue("Normal", 0);
            styleParam.AddNamedValue("Italic", 1);
        }

        if (pManager[5] is Param_Integer decorationParam)
        {
            decorationParam.AddNamedValue("None", 0);
            decorationParam.AddNamedValue("Underline", 1);
            decorationParam.AddNamedValue("Strikethrough", 2);
        }

        if (pManager[6] is Param_Integer hAnchorParam)
        {
            hAnchorParam.AddNamedValue("Left", 0);
            hAnchorParam.AddNamedValue("Center", 1);
            hAnchorParam.AddNamedValue("Right", 2);
        }

        if (pManager[7] is Param_Integer vAnchorParam)
        {
            vAnchorParam.AddNamedValue("Top", 0);
            vAnchorParam.AddNamedValue("Middle", 1);
            vAnchorParam.AddNamedValue("Baseline", 2);
            vAnchorParam.AddNamedValue("Bottom", 3);
        }
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_TextStyle("Style", "S", "Text style", "Selva", "Elements", GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var fontFamily = "Inter";
        var fontSize = 2.5;
        var color = Color.Black;
        var weightInt = 0;
        var styleInt = 0;
        var decorationInt = 0;
        var hAnchorInt = 0;
        var vAnchorInt = 2;
        var lineHeight = 1.2;
        var letterSpacing = 0.0;

        GetInput(DA, "Font Family", ref fontFamily);
        GetInput(DA, "Font Size", ref fontSize);
        GetInput(DA, "Color", ref color);
        GetInput(DA, "Weight", ref weightInt);
        GetInput(DA, "Style", ref styleInt);
        GetInput(DA, "Decoration", ref decorationInt);
        GetInput(DA, "Horizontal Anchor", ref hAnchorInt);
        GetInput(DA, "Vertical Anchor", ref vAnchorInt);
        GetInput(DA, "Line Height", ref lineHeight);
        GetInput(DA, "Letter Spacing", ref letterSpacing);

        var textStyle = new TextStyle
        {
            FontFamily = string.IsNullOrWhiteSpace(fontFamily) ? "Inter" : fontFamily,
            FontSize = Math.Max(0.01, fontSize),
            Color = ModelColor.Rgb(color.R, color.G, color.B, color.A),
            Weight = (FontWeight)Math.Max(0, Math.Min(1, weightInt)),
            Style = (ModelFontStyle)Math.Max(0, Math.Min(1, styleInt)),
            Decoration = (TextDecoration)Math.Max(0, Math.Min(2, decorationInt)),
            HorizontalAnchor = (TextAnchor)Math.Max(0, Math.Min(2, hAnchorInt)),
            VerticalAnchor = (VerticalAnchor)Math.Max(0, Math.Min(3, vAnchorInt)),
            LineHeight = Math.Max(0.1, lineHeight),
            LetterSpacing = letterSpacing,
        };

        // Non-bundled fonts are measured with a rough width heuristic while the viewer
        // substitutes a real font — wrapping and table sizing then drift from what renders.
        if (!Selva.Drawing.Fonts.FontMetrics.IsBundled(textStyle.FontFamily, textStyle.Weight, textStyle.Style))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                $"\"{textStyle.FontFamily}\" is not a bundled font — text is measured with approximate metrics, so wrapping and cell sizes may not match the rendered output. Bundled: Inter (Regular/Bold).");
        }

        DA.SetData(0, new TextStyleGoo(textStyle));
    }
}
