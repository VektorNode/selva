using System;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing;
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
    public override Guid ComponentGuid => new Guid("5D7E9A2B-3C4F-4B8E-A1D2-6F8B9C0E1F23");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddBrepParameter("Brep", "B", "Input Brep", GH_ParamAccess.item);
        pManager.AddGenericParameter("Style", "S", "Path style (use Path Style component)", GH_ParamAccess.item);

        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("SVG Surface", "SS", "SVG surface data", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Brep brep = null;
        PathStyleData style = null;
        var tolerance = 0.01;

        if (!DA.GetData(0, ref brep) || brep == null) return;
        DA.GetData(1, ref style);

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

            var fillStyle = style ?? new PathStyleData
            {
                FillColor = Color.LightGray,
                HasFill = true,
                StrokeColor = Color.Black,
                HasStroke = true,
                StrokeWidth = 1f
            };

            var bb = brep.GetBoundingBox(true);
            var data = new SvgSurfaceData
            {
                OuterPathData = outerPath,
                HolePathData = holePaths,
                Bounds = new SvgBounds(bb.Min.X, bb.Min.Y, bb.Max.X, bb.Max.Y),
                Style = fillStyle
            };

            DA.SetData(0, data);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating SVG surface: {e.Message}");
        }
    }
}
