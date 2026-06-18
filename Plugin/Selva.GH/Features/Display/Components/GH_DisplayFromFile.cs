using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

// Reloads a Web Display payload from a .dmf file written by Display To File. Skips the expensive
// mesh/quantize/compress path — the finished blob is read straight back — so reusing a saved part
// many times is cheap.
//
// Pick identity: the web keys selection on sourceComponentId (+ per-item ids). If the same .dmf is
// loaded into many instances, sharing one saved id would collide. So by default each loader stamps
// the batch with its own InstanceGuid; an explicit Id input overrides that when you want a stable,
// known identity.
public class GH_DisplayFromFile : GH_Component
{
    public GH_DisplayFromFile()
        : base("Display From File", "DFF",
            "Reloads a Web Display payload from a .dmf file (no re-meshing).",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("8B2E5C71-9A34-4F6D-B017-3C4D5E6F7A81");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Path", "P", "Absolute path to the .dmf file", GH_ParamAccess.item);
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
                batch = DmfFile.Read(fs);
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to read .dmf: {ex.Message}");
            return;
        }

        // Re-stamp the pick identity. Default to this component's id so reusing a saved part across
        // many loaders yields distinct identities; an explicit Id input pins it instead.
        var newId = !string.IsNullOrWhiteSpace(idOverride) ? idOverride : InstanceGuid.ToString();
        RestampSourceComponentId(batch, newId);

        DA.SetData(0, new WebDisplayGoo(batch));
    }

    /// <summary>
    ///     Rewrites the batch's <see cref="DisplayBatch.SourceComponentId" /> and the per-item pick
    ///     ids (synthesized as <c>{sourceComponentId}:{ordinal}</c>) to use <paramref name="newId" />.
    ///     The mesh blob's embedded metadata still carries the old id, but the web prefers the outer
    ///     batch's sourceComponentId over the blob's, so meshes pick up the new id without touching
    ///     (and re-encoding) the blob — keeping the no-re-mesh fast path intact.
    /// </summary>
    private static void RestampSourceComponentId(DisplayBatch batch, string newId)
    {
        var oldId = batch.SourceComponentId;
        batch.SourceComponentId = newId;

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

            // Item ids are "{oldId}:{ordinal}". Swap the prefix when it matches; otherwise leave as-is.
            if (oldId != null && item.Id.StartsWith(oldId + ":", StringComparison.Ordinal))
            {
                item.Id = newId + item.Id.Substring(oldId.Length);
            }
        }
    }
}
