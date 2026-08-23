using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.Drawing.Model;
using Selva.Drawing.Model.Drawings;
using Selva.Drawing.Model.Elements;
using Selva.Drawing.Model.Geometry;
using Selva.GH.Properties;

namespace Selva.GH.Features.Drawing.Components;

// One DrawingView per branch of the input tree; only Length/Padding are unit-interpreted,
// geometry coordinates pass through raw.
public class GH_DrawingView : GH_Component
{
    public GH_DrawingView()
        : base("Drawing View", "DView",
            "Group drawings into a scaled view. One view per input branch. Length sets the longest side in mm; leave at 0 to auto-fit the parent page.",
            "Selva", "Drawing")
    {
    }

    protected override Bitmap Icon => Resources.DrawingView;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("3336B561-6152-4CA0-83D6-C0F5EED76540");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawings", "Dwg", "Drawing elements to display. One branch = one view.", GH_ParamAccess.tree);
        pManager.AddNumberParameter("Length", "L", "Longest side of the view in document units (see Units). 0 = fit to the parent page.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Padding", "P", "Padding around the geometry in document units (see Units).", GH_ParamAccess.item, 5.0);
        pManager.AddBooleanParameter("Scale Caption", "SC", "Auto-label each view with 'SCALE 1:N' from the scale it actually renders at.", GH_ParamAccess.item, false);
        pManager.AddIntegerParameter("Units", "U", "Unit that Length and Padding are authored in. Auto = the active Rhino document's unit, so '20' means 20 of whatever you model in. Geometry coordinates always pass through raw.", GH_ParamAccess.item, DrawingUnits.Auto);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;

        if (pManager[4] is Grasshopper.Kernel.Parameters.Param_Integer unitsParam)
            DrawingUnits.AddNamedValues(unitsParam);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Drawings", "Dwg", "One drawing per input branch (each is a scaled view). Wire straight into Stack / Grid / Frame / Page or Render like any other drawing.", GH_ParamAccess.list);
        pManager.AddTextParameter("Scale", "S", "Inferred scale ratio per view (e.g. \"1:5\") when Length is set. Auto-fit views resolve their scale only once placed on a page — empty here.", GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        if (!DA.GetDataTree(0, out GH_Structure<IGH_Goo> tree))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
            return;
        }

        var length = 0.0;
        var padding = 5.0;
        var scaleCaption = false;
        var unitsIndex = DrawingUnits.Auto;
        DA.GetData(1, ref length);
        DA.GetData(2, ref padding);
        DA.GetData(3, ref scaleCaption);
        DA.GetData(4, ref unitsIndex);

        // Model is in mm; Length/Padding are authored in the chosen unit, so convert once here.
        var mmPerUnit = DrawingUnits.MmPerUnit(unitsIndex);
        length = length > 0 ? length * mmPerUnit : length;
        padding *= mmPerUnit;

        var views = new List<DrawingView>(tree.PathCount);
        var scaleLabels = new List<string>(tree.PathCount);
        var skipped = 0;
        foreach (var path in tree.Paths)
        {
            var branch = tree.get_Branch(path);
            var children = new List<DrawElement>(branch.Count);
            foreach (var item in branch)
            {
                if (item is GH_ObjectWrapper wrap && wrap.Value is DrawElement de) children.Add(de);
                else if (item is DrawElement direct) children.Add(direct);
                else if (item != null) skipped++;
            }
            if (children.Count == 0) continue;

            DrawElement geometry = children.Count == 1
                ? children[0]
                : new GroupElement { Children = children };

            views.Add(new DrawingView
            {
                Geometry = geometry,
                Length = length > 0 ? (double?)length : null,
                Padding = Margins.Uniform(Math.Max(0, padding)),
                AutoScaleCaption = scaleCaption,
            });

            // Auto-fit views only resolve their scale once placed on a page.
            if (length > 0)
            {
                var b = geometry.ComputeBounds();
                var longest = Math.Max(b.Width, b.Height);
                scaleLabels.Add(longest > 0
                    ? DrawingView.FormatScaleLabel(length / longest).Replace("SCALE ", "")
                    : "");
            }
            else
            {
                scaleLabels.Add("");
            }
        }

        if (skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"Skipped {skipped} input(s) that are not drawing elements — wire Rhino geometry through Draw Curve / Draw Surface first");
        }

        if (views.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "All branches were empty");
            return;
        }

        DA.SetDataList(0, views);
        DA.SetDataList(1, scaleLabels);
    }
}
