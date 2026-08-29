using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.Components;

// Diagnostics-only: wire a Display component's Web Display output in to see payload size — the
// binary mesh blob (what actually drives transport cost), JSON items size, and vertex/triangle
// totals. Hidden from the toolbar; not meant for production graphs.
public class GH_DisplaySize : GH_Component
{
    public GH_DisplaySize()
        : base("Display Size", "DSize",
            "Reports the byte size of a Web Display payload (binary geometry blob + JSON items).",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.DisplaySize;
    public override GH_Exposure Exposure => GH_Exposure.hidden;
    public override Guid ComponentGuid => new Guid("B2F6D3A1-7C84-4E29-9A5B-1D0E8C7F2A63");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Web Display output from the Display component", "Selva", "Display", GH_ParamAccess.item));
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddIntegerParameter("Bytes", "B", "Total payload size in bytes (binary blob + JSON items)",
            GH_ParamAccess.item);
        pManager.AddTextParameter("Size", "S", "Human-readable total payload size", GH_ParamAccess.item);
        pManager.AddIntegerParameter("Vertices", "V", "Total vertex count across all meshes",
            GH_ParamAccess.item);
        pManager.AddIntegerParameter("Triangles", "T", "Total triangle count across all meshes",
            GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var batch = ReadBatch(DA);
        if (batch == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid Web Display input");
            return;
        }

        var blobBytes = batch.CompressedData?.Length ?? 0;
        // Items travel as JSON alongside the blob — measure UTF-8 size, matching how they ship.
        var itemBytes = batch.Items != null && batch.Items.Count > 0
            ? System.Text.Encoding.UTF8.GetByteCount(JsonConvert.SerializeObject(batch.Items))
            : 0;
        var totalBytes = blobBytes + itemBytes;

        var (vertices, indices) = CountGeometry(batch);

        var compressed = IsGeometryDeflated(batch.CompressedData);
        var meshLabel = compressed ? $"{FormatBytes(blobBytes)} mesh, compressed" : $"{FormatBytes(blobBytes)} mesh";
        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
            $"{FormatBytes(totalBytes)}  ({meshLabel}, {FormatBytes(itemBytes)} items)");

        DA.SetData(0, totalBytes);
        DA.SetData(1, FormatBytes(totalBytes));
        DA.SetData(2, vertices);
        DA.SetData(3, indices / 3);
    }

    // "Compressed" means the geometry stream itself is deflated: SLVZ directly, or an SLVM
    // container whose GEOM payload is SLVZ. Diagnostics-only, so parsing the container is fine.
    private static bool IsGeometryDeflated(byte[] blob)
    {
        if (blob == null || blob.Length < 4)
        {
            return false;
        }

        if (BitConverter.ToUInt32(blob, 0) == BlobCompressor.CompressedMagic)
        {
            return true;
        }

        if (!SlvmDocument.IsSlvm(blob))
        {
            return false;
        }

        var geometry = SlvmDocument.Read(blob).GeometryBlob;
        return geometry != null && geometry.Length >= 4 &&
               BitConverter.ToUInt32(geometry, 0) == BlobCompressor.CompressedMagic;
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

    private static (int vertices, int indices) CountGeometry(DisplayBatch batch)
    {
        var vertices = 0;
        var indices = 0;
        if (batch.Groups == null)
        {
            return (0, 0);
        }

        foreach (var group in batch.Groups)
        {
            if (group.Meshes == null)
            {
                continue;
            }

            foreach (var mesh in group.Meshes)
            {
                vertices += mesh.VertexCount;
                indices += mesh.IndexCount;
            }
        }

        return (vertices, indices);
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB" };
        double size = bytes;
        var unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }

        return unit == 0 ? $"{bytes} {units[unit]}" : $"{size:0.##} {units[unit]}";
    }
}
