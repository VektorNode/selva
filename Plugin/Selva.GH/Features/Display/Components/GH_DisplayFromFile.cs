using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.Slva;

namespace Selva.GH.Features.Display.Components;

// Reads the finished blob straight back from a mesh file, skipping the mesh/quantize/compress path
// — cheap to reuse a saved part many times.
//
// Object identity travels inside the file (per-object ids in the container's table), so loading
// needs no restamping. Two loaders of the same file share ids by design: they are the same
// logical objects.
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

        DA.SetData(0, new WebDisplayGoo(batch));
    }
}
