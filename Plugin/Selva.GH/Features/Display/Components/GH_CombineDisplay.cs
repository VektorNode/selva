using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

// Collapses every branch of a Web Display tree into one payload on the same path: {0;0} holding
// five displays becomes {0;0} holding one. The tree structure survives, so a downstream Display To
// File writes one file per branch instead of one per item, and the viewer gets one payload per
// branch instead of many.
//
// Merging is a real re-encode, not a concatenation: materials dedupe across the branch (two inputs
// sharing a material become one group, one draw call) and the geometry is re-quantized over the
// branch's union bounding box. Names, layers and metadata ride along per mesh.
//
// A merged payload takes this component's own id for web pick identity, so each mesh records where
// it came from in its gh:component / gh:originalIndex metadata — provenance survives the merge.
public class GH_CombineDisplay : GH_Component
{
    public GH_CombineDisplay()
        : base("Combine Display", "CoDisplay",
            "Merges each branch of a Web Display tree into a single payload, deduplicating materials.",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("E2BA3FC1-3930-4E34-8034-7E096F419FD3");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Web Display payloads to merge. Every branch collapses to one payload on its own path.",
            "Selva", "Display", GH_ParamAccess.tree));
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "One combined payload per input branch", "Selva", "Display", GH_ParamAccess.tree));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        // Must be the param's own goo type: Param_WebDisplay is a GH_PersistentGeometryParam
        // <WebDisplayGoo>, and asking for a tree of IGH_Goo silently yields an empty structure
        // rather than failing.
        if (!DA.GetDataTree(0, out GH_Structure<WebDisplayGoo> tree) || tree.IsEmpty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No Web Display input");
            return;
        }

        var output = new GH_Structure<WebDisplayGoo>();
        var totalMeshes = 0;
        var branchesWritten = 0;

        for (var b = 0; b < tree.PathCount; b++)
        {
            var path = tree.Paths[b];
            var batches = new List<DisplayBatch>();
            foreach (var goo in tree.get_Branch(path))
            {
                var batch = AsBatch(goo as IGH_Goo);
                if (batch != null && batch.CompressedData != null)
                {
                    batches.Add(batch);
                }
            }

            if (batches.Count == 0)
            {
                continue;
            }

            // Each branch gets its own id: two branches sharing one would collide in the web's
            // pick keys, which are {batchId}:{originalIndex}.
            var branchId = $"{InstanceGuid}-{path}";

            DisplayBatchCombiner.Result combined;
            try
            {
                combined = DisplayBatchCombiner.Combine(batches, branchId);
            }
            catch (Exception ex)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"{path}: failed to combine — {ex.Message}");
                continue;
            }

            if (combined == null)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"{path}: no geometry to combine");
                continue;
            }

            foreach (var failure in combined.Failures)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"{path}: skipped an unreadable payload — {failure}");
            }

            output.Append(new WebDisplayGoo(combined.Batch), path);
            totalMeshes += combined.MeshCount;
            branchesWritten++;
        }

        if (branchesWritten == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid Web Display inputs");
            return;
        }

        Message = branchesWritten == 1
            ? $"{totalMeshes} meshes"
            : $"{branchesWritten} branches, {totalMeshes} meshes";
        DA.SetDataTree(0, output);
    }

    private static DisplayBatch AsBatch(IGH_Goo goo)
    {
        if (goo == null)
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
