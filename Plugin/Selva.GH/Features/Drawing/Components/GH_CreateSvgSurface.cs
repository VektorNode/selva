using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.GH.Features.Drawing.Lib;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateSvgSurface : GH_Component
{
    public GH_CreateSvgSurface()
        : base("Create SVG Surface", "CSS",
            "Converts a Brep to a filled SVG surface (with hole support)",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("1BFCD1BD-DA7F-4ED2-AE8D-34EA2C347B85");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddBrepParameter("Brep", "B", "Input Brep", GH_ParamAccess.item);
        pManager.AddGenericParameter("Style", "S", "Path style (use Path Style component)", GH_ParamAccess.item);
        pManager.AddTextParameter("ID", "ID", "Element id", GH_ParamAccess.item, "");
        pManager.AddTextParameter("CSS Class", "Cls", "CSS class", GH_ParamAccess.item, "");
        pManager.AddTextParameter("Metadata Keys", "MK", "Metadata keys", GH_ParamAccess.list);
        pManager.AddTextParameter("Metadata Values", "MV", "Metadata values", GH_ParamAccess.list);
        pManager.AddNumberParameter("Tolerance", "T", "Tolerance for joining edges", GH_ParamAccess.item, 0.01);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
        pManager[6].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Surface", "SS", "SVG surface data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Brep brep = null;
        PathStyleData style = null;
        var id = "";
        var cssClass = "";
        var metaKeys = new List<string>();
        var metaValues = new List<string>();
        var tolerance = 0.01;

        if (!DA.GetData(0, ref brep) || brep == null) return;
        DA.GetData(1, ref style);
        DA.GetData(2, ref id);
        DA.GetData(3, ref cssClass);
        DA.GetDataList(4, metaKeys);
        DA.GetDataList(5, metaValues);
        DA.GetData(6, ref tolerance);

        try
        {
            var outerEdges = brep.DuplicateNakedEdgeCurves(true, false);
            var innerEdges = brep.DuplicateNakedEdgeCurves(false, true);

            var outerJoined = Curve.JoinCurves(outerEdges, tolerance);
            var innerJoined = Curve.JoinCurves(innerEdges, tolerance);

            if (outerJoined == null || outerJoined.Length == 0)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Surface has no outer boundary");
                return;
            }

            var outerPath = CurveConverter.ToSvgPathData(outerJoined[0]);
            var holePaths = innerJoined
                .Select(c => CurveConverter.ToSvgPathData(c))
                .Where(s => !string.IsNullOrEmpty(s))
                .ToList();

            var metadata = new Dictionary<string, string>();
            for (var i = 0; i < Math.Min(metaKeys.Count, metaValues.Count); i++)
                if (!string.IsNullOrEmpty(metaKeys[i]))
                    metadata[metaKeys[i]] = metaValues[i] ?? "";

            var fillStyle = style ?? new PathStyleData
            {
                FillColor = Color.LightGray,
                HasFill = true,
                StrokeColor = Color.Black,
                HasStroke = true,
                StrokeWidth = 1f
            };

            var data = new SvgSurfaceData
            {
                OuterPathData = outerPath,
                HolePathData = holePaths,
                Bounds = brep.GetBoundingBox(true),
                Style = fillStyle,
                Id = id,
                CssClass = cssClass,
                Metadata = metadata
            };

            DA.SetData(0, data);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating SVG surface: {e.Message}");
        }
    }
}
