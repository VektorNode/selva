using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.Drawing.Model.Elements;
using Selva.GH.Features.Drawing.Preview;
using Selva.GH.Properties;
using DrawPoint = Selva.Drawing.Model.Geometry.Point2D;
using DrawTransform = Selva.Drawing.Model.Geometry.Transform;

namespace Selva.GH.Features.Drawing.Components;

// Places one reusable definition at many points. The renderers emit the definition once (SVG
// <symbol>, PDF Form XObject) and reference it per instance, so a drawing with hundreds of
// repeated marks — fixings, section flags, weld symbols — stays small. Dedupe is keyed on the
// definition Id, which is why Name matters beyond being a label.
public class GH_CreateSymbol : GH_Component
{
    private readonly ElementPreviewBuffer _preview = new ElementPreviewBuffer();

    public GH_CreateSymbol()
        : base("Draw Symbol", "DSym",
            "Places a reusable symbol at one or more points. The geometry is emitted once and referenced per instance",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.DrawSymbol;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("B62D8F14-95C7-4A03-8E1D-7F40C2B95E68");

    public override bool IsPreviewCapable => true;
    public override BoundingBox ClippingBox => _preview.ClippingBox;

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

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Definition", "D", "Drawing elements forming the symbol, drawn around its own origin", GH_ParamAccess.list);
        pManager.AddTextParameter("Name", "N", "Identity used to share one definition across instances. Instances with the same Name emit the geometry once; leave empty to expand each instance inline", GH_ParamAccess.item, "");
        pManager.AddPointParameter("Points", "P", "Insertion points in world XY space — one instance per point", GH_ParamAccess.list);
        pManager.AddNumberParameter("Scale", "S", "Uniform scale applied to each instance", GH_ParamAccess.item, 1.0);
        pManager.AddNumberParameter("Rotation", "R", "Rotation in degrees (counter-clockwise) applied to each instance", GH_ParamAccess.item, 0.0);

        pManager[1].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawing", "Dwg", "Drawing elements — one per insertion point", GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var definition = new List<IGH_Goo>();
        var name = "";
        var points = new List<Point3d>();
        var scale = 1.0;
        var rotation = 0.0;

        if (!DA.GetDataList(0, definition)) return;
        DA.GetData(1, ref name);
        if (!DA.GetDataList(2, points)) return;
        DA.GetData(3, ref scale);
        DA.GetData(4, ref rotation);

        var children = new List<DrawElement>(definition.Count);
        foreach (var item in definition)
        {
            if (item is GH_ObjectWrapper wrap && wrap.Value is DrawElement wrapped) children.Add(wrapped);
            else if (item is DrawElement direct) children.Add(direct);
        }

        if (children.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Definition contains no drawing elements");
            return;
        }

        if (points.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No insertion points");
            return;
        }

        // One shared definition object across every instance: the renderers dedupe on its Id,
        // and reusing the instance also lets them match by reference.
        var symbol = new SymbolDefinition
        {
            Id = string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
            Children = children,
        };

        var transform = BuildTransform(scale, rotation);

        var elements = new List<DrawElement>(points.Count);
        foreach (var p in points)
        {
            var element = new SymbolElement
            {
                Definition = symbol,
                Position = new DrawPoint(p.X, p.Y),
                Transform = transform,
            };
            _preview.Add(element);
            elements.Add(element);
        }

        DA.SetDataList(0, elements);
    }

    // Rotation about the instance origin, then uniform scale. Identity when both are default,
    // so the common case costs nothing downstream.
    private static DrawTransform BuildTransform(double scale, double rotationDegrees)
    {
        var s = scale == 0 ? 1.0 : scale;
        if (s == 1.0 && rotationDegrees == 0.0) return DrawTransform.Identity;
        return DrawTransform.RotateDegrees(rotationDegrees).Then(DrawTransform.Scale(s));
    }
}
