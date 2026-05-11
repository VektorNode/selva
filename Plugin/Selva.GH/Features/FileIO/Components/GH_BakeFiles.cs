using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.FileIO.Components;

public class GH_BakeFiles : GH_Component
{
    public GH_BakeFiles()
        : base("Bake Files", "BakeFiles",
            "Write multiple files to disk at a specified path",
            "Selva", "IO")
    {
    }

    protected override Bitmap Icon => Resources.BakeFile;

    public override Guid ComponentGuid => new Guid("E7F8A3B2-4C9D-4F1E-8A5C-9B7D2E1F3A6C");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Files", "F", "File data to bake (from Create File or Block to File components)",
            GH_ParamAccess.list);
        pManager.AddTextParameter("Base Path", "P", "Folder path where files will be written",
            GH_ParamAccess.item);
        pManager.AddBooleanParameter("Bake", "B", "Set to true to write files to disk",
            GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("Paths", "Paths", "Full file paths that were written", GH_ParamAccess.list);
        pManager.AddTextParameter("Status", "S", "Status message", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var files = new List<FileDataGoo>();
        var basePath = "";
        var bake = false;

        if (!DA.GetDataList(0, files))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "No files provided");
            return;
        }

        if (!DA.GetData(1, ref basePath))
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "No base path provided");
            return;
        }

        DA.GetData(2, ref bake);

        if (!bake)
        {
            DA.SetData(1, "Ready to bake (set 'Bake' to true)");
            return;
        }

        try
        {
            var writtenPaths = BakeFilesToDisk(files, basePath);

            DA.SetDataList(0, writtenPaths);
            DA.SetData(1, $"Successfully wrote {writtenPaths.Count} file(s)");
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to bake files: {ex.Message}");
            DA.SetData(1, $"Error: {ex.Message}");
        }
    }

    public List<string> BakeFilesToDisk(List<FileDataGoo> files, string basePath)
    {
        var writtenPaths = new List<string>();

        if (string.IsNullOrWhiteSpace(basePath))
        {
            throw new InvalidOperationException("Base path cannot be empty");
        }

        basePath = Path.GetFullPath(basePath);

        if (!Directory.Exists(basePath))
        {
            Directory.CreateDirectory(basePath);
        }

        foreach (var fileGoo in files)
        {
            if (fileGoo?.Value is not FileData fileData)
            {
                continue;
            }

            var filePath = BuildFilePath(basePath, fileData);
            WriteFileToPath(filePath, fileData);
            writtenPaths.Add(filePath);
        }

        return writtenPaths;
    }

    private string BuildFilePath(string basePath, FileData fileData)
    {
        var subFolder = !string.IsNullOrEmpty(fileData.SubFolder)
            ? fileData.SubFolder
            : "";

        var fullDirectory = string.IsNullOrEmpty(subFolder)
            ? basePath
            : Path.Combine(basePath, subFolder);

        if (!Directory.Exists(fullDirectory))
        {
            Directory.CreateDirectory(fullDirectory);
        }

        var fileName = fileData.FileName ?? "file";
        var extension = fileData.FileType ?? ".bin";

        if (!extension.StartsWith("."))
        {
            extension = "." + extension;
        }

        return Path.Combine(fullDirectory, fileName + extension);
    }

    private void WriteFileToPath(string filePath, FileData fileData)
    {
        try
        {
            var data = fileData.Data ?? "";

            if (fileData.IsBase64Encoded)
            {
                var bytes = Convert.FromBase64String(data);
                File.WriteAllBytes(filePath, bytes);
            }
            else
            {
                File.WriteAllText(filePath, data);
            }
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Failed to write file '{filePath}': {ex.Message}", ex);
        }
    }
}
