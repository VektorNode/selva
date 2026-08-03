using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.FileIO.Components;

public class GH_DataToFileGeneric : GH_Component, ISelvaFileOutput
{
    public GH_DataToFileGeneric()
        : base("Create File", "MkFile",
            "Creates a file from text or base64 data.",
            "Selva", "IO")
    {
    }

    protected override Bitmap Icon => Resources.CreateFile;

    public override Guid ComponentGuid => new Guid("4A845B41-30E7-4DC7-BD47-0AC4C44E4F46");

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Data", "D", "File content as text or base64 string", GH_ParamAccess.list);
        pManager.AddTextParameter("Name", "N", "File name without extension", GH_ParamAccess.item, "file");
        pManager.AddTextParameter("Extension", "Ext", "File extension including dot, e.g. .txt, .csv, .json",
            GH_ParamAccess.item, ".txt");
        pManager.AddBooleanParameter("Is Base64", "B64", "Set to true if Data is already base64-encoded",
            GH_ParamAccess.item, false);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item,
            "");
        pManager.AddTextParameter("Metadata", "M",
            "Optional metadata as \"key=value\" lines (e.g. author=felix). Rides along with the file for downstream tagging/indexing.",
            GH_ParamAccess.list);
        pManager[5].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "File data for download via the Selva UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        var data = new List<string>();
        var name = "file";
        var extension = ".txt";
        var isBase64 = false;
        var subFolder = "";

        if (!DA.GetDataList(0, data))
        {
            return;
        }

        DA.GetData(1, ref name);
        DA.GetData(2, ref extension);
        DA.GetData(3, ref isBase64);
        DA.GetData(4, ref subFolder);

        var metadataLines = new List<string>();
        DA.GetDataList(5, metadataLines);

        if (!string.IsNullOrEmpty(extension) && !extension.StartsWith("."))
        {
            extension = "." + extension;
        }

        var combinedData = isBase64
            ? string.Concat(data)
            : string.Join(Environment.NewLine, data);

        var fileData = new FileData
        {
            FileName = name ?? "file",
            Data = combinedData,
            FileType = extension,
            IsBase64Encoded = isBase64,
            SubFolder = subFolder ?? "",
            Metadata = FileMetadataParser.Parse(metadataLines)
        };

        DA.SetData(0, new FileDataGoo(fileData));
    }
}
