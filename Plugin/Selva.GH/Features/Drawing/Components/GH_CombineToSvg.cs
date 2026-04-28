using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CombineToSvg : GH_Component
{
    public GH_CombineToSvg()
        : base("Combine to SVG", "CTS",
            "Combines SVG curves and surfaces into one SVG document",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("D6E1521D-DA7F-43A7-8B71-8E0B35CF5F33");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Curves", "SC", "List of SVG curves", GH_ParamAccess.list);
        pManager.AddGenericParameter("SVG Surfaces", "SS", "List of SVG surfaces", GH_ParamAccess.list);
        pManager.AddGenericParameter("SVG Dimensions", "SD", "List of SVG dimensions", GH_ParamAccess.list);
        pManager.AddTextParameter("Title", "T", "SVG title", GH_ParamAccess.item, "Drawing");
        pManager.AddNumberParameter("Padding", "P", "Padding around content", GH_ParamAccess.item, 10.0);

        pManager[0].Optional = true;
        pManager[1].Optional = true;
        pManager[2].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("SVG", "SVG", "SVG document", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var curves = new List<SvgCurveData>();
        var surfaces = new List<SvgSurfaceData>();
        var dimensions = new List<SvgDimensionData>();
        var title = "Drawing";
        var padding = 10.0;

        DA.GetDataList(0, curves);
        DA.GetDataList(1, surfaces);
        DA.GetDataList(2, dimensions);
        DA.GetData(3, ref title);
        DA.GetData(4, ref padding);

        if (!curves.Any() && !surfaces.Any() && !dimensions.Any())
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No content provided");
            return;
        }

        try
        {
            var svg = BuildSvg(curves, surfaces, dimensions, title, padding);
            DA.SetData(0, svg);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error building SVG: {e.Message}");
        }
    }

    private static string BuildSvg(
        List<SvgCurveData> curves,
        List<SvgSurfaceData> surfaces,
        List<SvgDimensionData> dimensions,
        string title,
        double padding)
    {
        var bounds = BoundingBox.Empty;
        foreach (var s in surfaces) bounds.Union(s.Bounds);
        foreach (var c in curves) bounds.Union(c.Bounds);
        foreach (var d in dimensions) bounds.Union(d.Bounds);

        if (!bounds.IsValid)
            return "<svg xmlns='http://www.w3.org/2000/svg' version='1.1'></svg>";

        // SVG viewBox uses post-Y-flip coordinates: world Y range becomes -maxY..-minY.
        var minX = bounds.Min.X - padding;
        var minY = -bounds.Max.Y - padding;
        var width = (bounds.Max.X - bounds.Min.X) + padding * 2;
        var height = (bounds.Max.Y - bounds.Min.Y) + padding * 2;

        var sb = new StringBuilder();
        sb.AppendLine("<?xml version='1.0' encoding='UTF-8'?>");
        sb.Append("<svg xmlns='http://www.w3.org/2000/svg' version='1.1'");
        sb.Append(" width='").Append(SvgWriter.F(width)).Append('\'');
        sb.Append(" height='").Append(SvgWriter.F(height)).Append('\'');
        sb.Append(" viewBox='")
          .Append(SvgWriter.F(minX)).Append(' ')
          .Append(SvgWriter.F(minY)).Append(' ')
          .Append(SvgWriter.F(width)).Append(' ')
          .Append(SvgWriter.F(height)).Append('\'');
        sb.AppendLine(">");

        if (!string.IsNullOrEmpty(title))
            sb.Append("<title>").Append(SvgWriter.Escape(title)).AppendLine("</title>");

        // Arrowhead marker for dimensions
        if (dimensions.Count > 0)
        {
            sb.AppendLine("<defs>");
            sb.AppendLine("  <marker id='selva-dim-arrow' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>");
            sb.AppendLine("    <path d='M 0 0 L 10 5 L 0 10 Z' fill='context-stroke' />");
            sb.AppendLine("  </marker>");
            sb.AppendLine("</defs>");
        }

        // Single root Y-flip — everything else uses Rhino-world coordinates.
        sb.AppendLine("<g transform='matrix(1 0 0 -1 0 0)'>");

        foreach (var s in surfaces) AppendSurface(sb, s);
        foreach (var c in curves) AppendCurve(sb, c);
        foreach (var d in dimensions) AppendDimension(sb, d);

        sb.AppendLine("</g>");
        sb.AppendLine("</svg>");
        return sb.ToString();
    }

    private static void AppendCurve(StringBuilder sb, SvgCurveData c)
    {
        sb.Append("  <path");
        AppendIdClass(sb, c.Id, c.CssClass);
        sb.Append(" d='").Append(c.PathData).Append('\'');
        SvgWriter.AppendStyle(sb, c.Style);
        AppendData(sb, c.Metadata);
        sb.AppendLine(" />");
    }

    private static void AppendSurface(StringBuilder sb, SvgSurfaceData s)
    {
        sb.Append("  <path");
        AppendIdClass(sb, s.Id, s.CssClass);
        sb.Append(" d='").Append(s.CombinedPathData).Append('\'');
        if (s.HolePathData.Count > 0) sb.Append(" fill-rule='evenodd'");
        SvgWriter.AppendStyle(sb, s.Style);
        AppendData(sb, s.Metadata);
        sb.AppendLine(" />");
    }

    private static void AppendDimension(StringBuilder sb, SvgDimensionData d)
    {
        sb.Append("  <g class='dimension");
        if (!string.IsNullOrEmpty(d.CssClass)) sb.Append(' ').Append(d.CssClass);
        sb.Append('\'');
        if (!string.IsNullOrEmpty(d.Id)) sb.Append(" id='").Append(SvgWriter.Escape(d.Id)).Append('\'');
        sb.AppendLine(">");

        // Extension lines + dimension line + label, all pre-baked into Body.
        sb.Append(d.Body);

        sb.AppendLine("  </g>");
    }

    private static void AppendIdClass(StringBuilder sb, string id, string cls)
    {
        if (!string.IsNullOrEmpty(id)) sb.Append(" id='").Append(SvgWriter.Escape(id)).Append('\'');
        if (!string.IsNullOrEmpty(cls)) sb.Append(" class='").Append(SvgWriter.Escape(cls)).Append('\'');
    }

    private static void AppendData(StringBuilder sb, Dictionary<string, string> metadata)
    {
        if (metadata == null) return;
        foreach (var kv in metadata)
        {
            if (string.IsNullOrEmpty(kv.Key) || kv.Key.StartsWith("_")) continue;
            sb.Append(" data-").Append(kv.Key).Append("='").Append(SvgWriter.Escape(kv.Value)).Append('\'');
        }
    }
}
