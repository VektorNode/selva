using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

// Unpacks a Web Display back into one Rhino mesh per entry in its mesh table, with the name, layer
// and colour each entry carried.
//
// A batch is a collection, but a Mesh param holds one mesh, so casting a Web Display straight into
// one joins every mesh into a single result. That join has a ceiling — a batch of thousands of
// meshes overruns what one Mesh can address — and it discards per-mesh identity either way. This
// component is the route that keeps both.
public class GH_DeconstructDisplay : GH_Component
{
    public GH_DeconstructDisplay()
        : base("Deconstruct Display", "DeDisplay",
            "Extracts the individual meshes from a Web Display payload, with their names and layers.",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.DeconstructDisplay;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("E63C2334-7FA5-4D62-B5AB-622A726D9AAF");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Web Display payload to unpack", "Selva", "Display", GH_ParamAccess.item));
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddMeshParameter("Meshes", "M", "One mesh per entry in the payload's mesh table",
            GH_ParamAccess.list);
        pManager.AddTextParameter("Names", "N", "Mesh names, parallel to Meshes", GH_ParamAccess.list);
        pManager.AddTextParameter("Layers", "L", "Layer paths, parallel to Meshes", GH_ParamAccess.list);
        pManager.AddColourParameter("Colors", "C", "Material colour per mesh, parallel to Meshes",
            GH_ParamAccess.list);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var batch = ReadBatch(DA);
        if (batch == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid Web Display input");
            return;
        }

        var extracted = WebDisplayPreview.ExtractMeshes(batch);
        if (extracted.Count == 0)
        {
            // Distinguishes the two ways to get nothing: a curves/points-only batch is expected,
            // a batch that declares meshes but yields none means the blob failed to decode.
            var declared = CountDeclaredMeshes(batch);
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                declared > 0
                    ? $"Payload declares {declared} mesh(es) but none could be decoded."
                    : "Payload contains no meshes.");
            return;
        }

        var meshes = new List<Mesh>(extracted.Count);
        var names = new List<string>(extracted.Count);
        var layers = new List<string>(extracted.Count);
        var colors = new List<Color>(extracted.Count);

        foreach (var (mesh, meta, color) in extracted)
        {
            meshes.Add(mesh);
            names.Add(meta.Name ?? "");
            layers.Add(meta.Layer ?? "");
            colors.Add(color);
        }

        DA.SetDataList(0, meshes);
        DA.SetDataList(1, names);
        DA.SetDataList(2, layers);
        DA.SetDataList(3, colors);
    }

    private static int CountDeclaredMeshes(DisplayBatch batch)
    {
        if (batch.Groups == null)
        {
            return 0;
        }

        var count = 0;
        foreach (var group in batch.Groups)
        {
            count += group.Meshes?.Count ?? 0;
        }

        return count;
    }

    private static DisplayBatch ReadBatch(IGH_DataAccess DA)
    {
        IGH_Goo goo = null;
        if (!DA.GetData(0, ref goo) || goo == null)
        {
            return null;
        }

        if (goo is WebDisplayGoo wd)
        {
            return wd.Value;
        }

        // Fall back to a JSON cast — e.g. the value arrived as a string via compute/file IO.
        var batchGoo = new WebDisplayGoo();
        return batchGoo.CastFrom(goo) ? batchGoo.Value : null;
    }
}
