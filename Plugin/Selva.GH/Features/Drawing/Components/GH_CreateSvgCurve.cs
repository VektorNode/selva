using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateSvgCurve : GH_Component
{
    public GH_CreateSvgCurve()
        : base("Create SVG Curve", "CSC",
            "Converts a Rhino curve to SVG-ready data",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("A2325EE3-93D8-426B-B86A-D8E7C62B7A37");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddCurveParameter("Curve", "C", "Input curve", GH_ParamAccess.item);
        pManager.AddGenericParameter("Style", "S", "Path style", GH_ParamAccess.item);
        pManager.AddTextParameter("ID", "ID", "Element id", GH_ParamAccess.item, "");
        pManager.AddTextParameter("CSS Class", "Cls", "CSS class", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Metadata Keys", "MK", "Metadata keys", GH_ParamAccess.list);
        pManager.AddTextParameter("Metadata Values", "MV", "Metadata values", GH_ParamAccess.list);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Curve", "SC", "SVG curve data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Curve curve = null;
        PathStyleData style = null;
        var id = "";
        var cssClass = "";
        var metaKeys = new List<string>();
        var metaValues = new List<string>();

        if (!DA.GetData(0, ref curve) || curve == null) return;
        DA.GetData(1, ref style);
        DA.GetData(2, ref id);
        DA.GetData(3, ref cssClass);
        DA.GetDataList(4, metaKeys);
        DA.GetDataList(5, metaValues);

        try
        {
            var pathData = CurveConverter.ToSvgPathData(curve);
            if (string.IsNullOrEmpty(pathData))
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Curve produced no path data");
                return;
            }

            var metadata = new Dictionary<string, string>();
            for (var i = 0; i < Math.Min(metaKeys.Count, metaValues.Count); i++)
                if (!string.IsNullOrEmpty(metaKeys[i]))
                    metadata[metaKeys[i]] = metaValues[i] ?? "";

            var svgCurve = new SvgCurveData
            {
                PathData = pathData,
                Bounds = curve.GetBoundingBox(true),
                Style = style ?? new PathStyleData(),
                Id = id,
                CssClass = cssClass,
                Metadata = metadata
            };

            DA.SetData(0, svgCurve);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating SVG curve: {e.Message}");
        }
    }
}
