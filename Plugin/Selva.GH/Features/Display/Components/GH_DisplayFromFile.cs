using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

// Reads the finished blob straight back from a mesh file, skipping the mesh/quantize/compress path
// — cheap to reuse a saved part many times.
//
// The web keys pick selection on batchId (+ per-item ids). Loading the same file into many
// instances would collide on one shared id, so each loader stamps its own InstanceGuid by default;
// an explicit Id input pins a stable identity instead.
public class GH_DisplayFromFile : GH_Component
{
    public GH_DisplayFromFile()
        : base("Display From File", "DFF",
            "Reloads a Web Display payload from a Selva mesh file (.slvm, no re-meshing).",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.DisplayFromFile;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("8B2E5C71-9A34-4F6D-B017-3C4D5E6F7A81");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Path", "P", "Absolute path to the mesh file (.slvm)",
            GH_ParamAccess.item);
        pManager.AddTextParameter("Id", "Id",
            "Optional source component id to stamp on the payload (for stable web pick identity). " +
            "Leave empty to use this component's own id so each instance is distinct.",
            GH_ParamAccess.item, "");
        pManager[1].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Reloaded Web Display payload", "Selva", "Display", GH_ParamAccess.item));
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string path = null;
        if (!DA.GetData(0, ref path) || string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        if (!File.Exists(path))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"File not found: {path}");
            return;
        }

        var idOverride = "";
        DA.GetData(1, ref idOverride);

        DisplayBatch batch;
        try
        {
            using (var fs = File.OpenRead(path))
            {
                batch = SlvmFile.Read(fs);
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to read mesh file: {ex.Message}");
            return;
        }

        var newId = !string.IsNullOrWhiteSpace(idOverride) ? idOverride : InstanceGuid.ToString();
        RestampSourceComponentId(batch, newId);

        DA.SetData(0, new WebDisplayGoo(batch));
    }

    // A v2 blob carries the id in its EXTN chunk, which binary WebSocket frames rely on (they have
    // no JSON envelope to override it) — rewrite that chunk; the geometry is never re-encoded. A
    // legacy blob keeps its baked-in id: there the web's envelope-wins precedence covers it.
    private static void RestampSourceComponentId(DisplayBatch batch, string newId)
    {
        var oldId = batch.BatchId;
        batch.BatchId = newId;

        if (SlvmDocument.IsSlvm(batch.CompressedData))
        {
            batch.CompressedData = SlvmDocument.Restamp(batch.CompressedData, newId);
        }

        if (batch.Items == null)
        {
            return;
        }

        foreach (var item in batch.Items)
        {
            if (item?.Id == null)
            {
                continue;
            }

            // Item ids are "{oldId}:{ordinal}" — swap the prefix, leave non-matching ids alone.
            if (oldId != null && item.Id.StartsWith(oldId + ":", StringComparison.Ordinal))
            {
                item.Id = newId + item.Id.Substring(oldId.Length);
            }
        }
    }
}
