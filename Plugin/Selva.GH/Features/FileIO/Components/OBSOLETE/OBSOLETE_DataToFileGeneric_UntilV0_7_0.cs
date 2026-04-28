using System;
using System.Drawing;
using Grasshopper.Kernel;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.FileIO.Components;

public class OBSOLETE_DataToFileGeneric_UntilV0_7_0 : GH_Component, ISelvaFileOutput
{
    public OBSOLETE_DataToFileGeneric_UntilV0_7_0()
        : base("Create File", "MkFile",
            "Creates a file from text or base64 data.",
            "Selva", "IO")
    {
    }

    protected override Bitmap Icon => Resources.CreateFile;

    public override Guid ComponentGuid => new Guid("D7A3E1C5-B248-4F9A-8C6D-2E5F1A3B7D9E");


    public override GH_Exposure Exposure => GH_Exposure.hidden;

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("Data", "D", "File content as text or base64 string", GH_ParamAccess.item);
        pManager.AddTextParameter("Name", "N", "File name without extension", GH_ParamAccess.item, "file");
        pManager.AddTextParameter("Extension", "Ext", "File extension including dot, e.g. .txt, .csv, .json",
            GH_ParamAccess.item, ".txt");
        pManager.AddBooleanParameter("Is Base64", "B64", "Set to true if Data is already base64-encoded",
            GH_ParamAccess.item, false);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder path for storage", GH_ParamAccess.item,
            "");
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("File", "F", "File data for download via the Selva UI", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string data = null;
        var name = "file";
        var extension = ".txt";
        var isBase64 = false;
        var subFolder = "";

        if (!DA.GetData(0, ref data))
        {
            return;
        }

        DA.GetData(1, ref name);
        DA.GetData(2, ref extension);
        DA.GetData(3, ref isBase64);
        DA.GetData(4, ref subFolder);

        // Ensure extension starts with a dot
        if (!string.IsNullOrEmpty(extension) && !extension.StartsWith("."))
        {
            extension = "." + extension;
        }

        var fileData = new FileData
        {
            FileName = name ?? "file",
            Data = data,
            FileType = extension,
            IsBase64Encoded = isBase64,
            SubFolder = subFolder ?? ""
        };

        DA.SetData(0, new FileDataGoo(fileData));
    }
}
