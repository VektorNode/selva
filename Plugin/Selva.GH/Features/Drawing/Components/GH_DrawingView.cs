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

// One DrawingView per branch of the input tree. Each branch's elements are grouped at
// their world coordinates and treated as a single view. Length pins the longest side of
// the geometry to N millimetres (0 = fit to whatever Page/container the view ends up in).
public class GH_DrawingView : GH_Component
{
    public GH_DrawingView()
        : base("Drawing View", "DView",
            "Group geometry into a scaled view. One view per input branch. Length sets the longest side in mm; leave at 0 to auto-fit the parent page.",
            "Selva", "Elements")
    {
    }

    protected override Bitmap Icon => Resources.DrawingView;
    public override GH_Exposure Exposure => GH_Exposure.last;
    public override Guid ComponentGuid => new Guid("3336B561-6152-4CA0-83D6-C0F5EED76540");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Geometry", "G", "Drawing elements to display. One branch = one view.", GH_ParamAccess.tree);
        pManager.AddNumberParameter("Length", "L", "Longest side of the view in mm. 0 = fit to the parent page.", GH_ParamAccess.item, 0.0);
        pManager.AddNumberParameter("Padding", "P", "Padding around the geometry in mm.", GH_ParamAccess.item, 5.0);

        pManager[1].Optional = true;
        pManager[2].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Views", "V", "One drawing view per input branch", GH_ParamAccess.list);
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
        DA.GetData(1, ref length);
        DA.GetData(2, ref padding);

        var views = new List<DrawingView>(tree.PathCount);
        foreach (var path in tree.Paths)
        {
            var branch = tree.get_Branch(path);
            var children = new List<DrawElement>(branch.Count);
            foreach (var item in branch)
            {
                if (item is GH_ObjectWrapper wrap && wrap.Value is DrawElement de) children.Add(de);
                else if (item is DrawElement direct) children.Add(direct);
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
            });
        }

        if (views.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "All branches were empty");
            return;
        }

        DA.SetDataList(0, views);
    }
}
