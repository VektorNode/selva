using System;
using System.Drawing;
using Grasshopper.Kernel;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.Drawing.Model.Style;
using Selva.GH.Features.Drawing.Lib;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;
using Path = Selva.Drawing.Model.Geometry.Path;

namespace Selva.GH.Features.Drawing.Components;

public class GH_CreateSurface : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateSurface()
        : base("Draw Surface", "DSrf",
            "Converts a Brep to a filled drawing surface (with hole support)",
            "Selva", "Elements")
    {
    }

    protected override Bitmap Icon => Resources.DrawSurface;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("29735748-B215-42FB-85D0-85549F26F28E");

    public override bool IsPreviewCapable => true;
    public override Rhino.Geometry.BoundingBox ClippingBox => _preview.ClippingBox;

    public override void ClearData()
    {
        base.ClearData();
        _preview.Clear();
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || Hidden) return;
        _preview.Render(args);
    }

    public override void DrawViewportMeshes(IGH_PreviewArgs args)
    {
        if (Locked || Hidden) return;
        _preview.Render(args);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddBrepParameter("Brep", "B", "Input Brep", GH_ParamAccess.item);
        pManager.AddGenericParameter("Style", "S", "Path style (use Path Style component)", GH_ParamAccess.item);

        pManager[1].Optional = true;
    }


    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Element", "E", "Drawing element", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        Brep brep = null;
        PathStyle style = null;
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

            // Build a single Path with the outer subpath followed by hole subpaths. The
            // renderer emits fill-rule when more than one MoveTo is present, so multi-hole
            // surfaces get the right cutout behaviour automatically.
            var builder = new Path.Builder();
            AppendCurve(builder, outerJoined[0], tolerance);
            if (innerJoined != null)
            {
                foreach (var hole in innerJoined)
                    AppendCurve(builder, hole, tolerance);
            }
            var combinedPath = builder.Build();

            // Default style for surfaces matches legacy: light-gray fill, black hairline stroke.
            var stroke = style?.Stroke ?? new Stroke
            {
                Color = Selva.Drawing.Model.Style.Color.Black,
                Width = 1.0,
            };
            var fill = style?.Fill ?? new Fill
            {
                Color = Selva.Drawing.Model.Style.Color.Rgb((byte)211, (byte)211, (byte)211), // LightGray (0xD3D3D3)
                Rule = FillRule.EvenOdd,
            };

            var element = new PathElement
            {
                Path = combinedPath,
                Stroke = stroke,
                Fill = fill,
            };

            _preview.Add(element);
            DA.SetData(0, element);
        }
        catch (Exception e)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error creating surface element: {e.Message}");
        }
    }

    private static void AppendCurve(Path.Builder builder, Curve curve, double tolerance)
    {
        var sub = CurveConverter.ToPath(curve, tolerance);
        foreach (var seg in sub) AppendSegment(builder, seg);
    }

    private static void AppendSegment(Path.Builder builder, PathSegment seg)
    {
        switch (seg)
        {
            case PathSegment.MoveTo m: builder.MoveTo(m.To); break;
            case PathSegment.LineTo l: builder.LineTo(l.To); break;
            case PathSegment.CubicTo c: builder.CubicTo(c.Control1, c.Control2, c.To); break;
            case PathSegment.ArcTo a: builder.ArcTo(a.To, a.RadiusX, a.RadiusY, a.XAxisRotationDegrees, a.LargeArc, a.SweepClockwise); break;
            case PathSegment.Close _: builder.Close(); break;
        }
    }
}
