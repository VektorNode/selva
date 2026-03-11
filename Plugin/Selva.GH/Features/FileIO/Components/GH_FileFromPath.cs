using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.FileIO.Components;

public class GH_FileFromPath : GH_Component, ISelvaFileOutput
{
    public GH_FileFromPath()
        : base("File From Path", "FilePath",
            "Reads a file from disk and outputs it as file data.",
            "Selva", "IO")
    {
    }

    protected override Bitmap Icon => Resources.PathToFile;

    public override Guid ComponentGuid => new("F2B8D4A6-C3E7-4B1F-9D5A-8E2C6F4A1B3D");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Path", "P", "Absolute path to the file on disk", GH_ParamAccess.item);
        pManager.AddTextParameter("Name", "N", "Override file name (leave empty to use the file's actual name)",
            GH_ParamAccess.item, "");
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item,
            "");
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "File data for download via the Selva UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string path = null;
        var nameOverride = "";
        var subFolder = "";

        if (!DA.GetData(0, ref path)) return;
        DA.GetData(1, ref nameOverride);
        DA.GetData(2, ref subFolder);

        if (!File.Exists(path))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"File not found: {path}");
            return;
        }

        var extension = Path.GetExtension(path);
        var fileName = string.IsNullOrWhiteSpace(nameOverride)
            ? Path.GetFileName(path)
            : nameOverride + extension;

        byte[] bytes;
        try
        {
            bytes = File.ReadAllBytes(path);
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to read file: {ex.Message}");
            return;
        }

        var fileData = new FileData
        {
            FileName = fileName,
            Data = Convert.ToBase64String(bytes),
            FileType = extension,
            IsBase64Encoded = true,
            SubFolder = subFolder ?? ""
        };

        DA.SetData(0, new FileDataGoo(fileData));
    }
}
