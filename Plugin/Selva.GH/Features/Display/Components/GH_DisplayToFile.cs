using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;

namespace Selva.GH.Features.Display.Components;

// Writes the blob to disk verbatim (no re-mesh, no re-encode) — mesh a part once, save it, then
// reload the finished display with Display From File wherever the part repeats in a scene.
public class GH_DisplayToFile : GH_Component
{
    public GH_DisplayToFile()
        : base("Display To File", "D2F",
            "Saves a Web Display payload to a Selva mesh file (.slvm) on disk for fast reuse (no re-meshing on reload).",
            "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.DisplayToFile;
    public override GH_Exposure Exposure => GH_Exposure.quarternary;
    public override Guid ComponentGuid => new Guid("3C9A7E1F-4D62-4B8A-8F05-6E1D2C3B4A50");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Web Display payload from the Display component", "Selva", "Display", GH_ParamAccess.item));
        pManager.AddTextParameter("Path", "P",
            "Absolute path to write the mesh file to (.slvm is added when missing)",
            GH_ParamAccess.item);
        pManager.AddBooleanParameter("Write", "W", "Set to true to write the file", GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("Path", "P", "The path the mesh file was written to", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        IGH_Goo goo = null;
        if (!DA.GetData(0, ref goo) || goo == null)
        {
            return;
        }

        string path = null;
        if (!DA.GetData(1, ref path) || string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        var write = false;
        DA.GetData(2, ref write);

        var batch = goo is WebDisplayGoo wd ? wd.Value : null;
        if (batch == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Input is not a valid Web Display");
            return;
        }

        if (!path.EndsWith(SlvmFile.Extension, StringComparison.OrdinalIgnoreCase))
        {
            path += SlvmFile.Extension;
        }

        if (!write)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, "Set Write to true to save the file");
            DA.SetData(0, path);
            return;
        }

        try
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            using (var fs = File.Create(path))
            {
                SlvmFile.Write(fs, batch);
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to write mesh file: {ex.Message}");
            return;
        }

        DA.SetData(0, path);
    }
}
