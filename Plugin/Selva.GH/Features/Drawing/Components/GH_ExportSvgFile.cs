using System;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;

namespace Selva.GH.Features.Drawing.Components;

public class GH_ExportSvgFile : GH_Component
{
    public GH_ExportSvgFile()
        : base("Export SVG File", "ESF",
            "Writes an SVG document to a file",
            "Selva", "SVG")
    {
    }

    protected override Bitmap Icon => null;
    public override GH_Exposure Exposure => GH_Exposure.primary;
    public override Guid ComponentGuid => new Guid("E8609DFF-085E-4232-B0CB-57B96A12326B");

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddTextParameter("SVG Content", "SVG", "SVG content to export", GH_ParamAccess.item);
        pManager.AddTextParameter("File Path", "FP", "Output file path", GH_ParamAccess.item);
        pManager.AddBooleanParameter("Write", "W", "Trigger to write file", GH_ParamAccess.item, false);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddTextParameter("Status", "S", "Export status", GH_ParamAccess.item);
        pManager.AddTextParameter("Full Path", "FP", "Full file path", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        string svgContent = null;
        string filePath = null;
        var write = false;

        if (!DA.GetData(0, ref svgContent)) return;
        if (!DA.GetData(1, ref filePath)) return;
        DA.GetData(2, ref write);

        var status = "Ready";
        var fullPath = "";

        if (write && !string.IsNullOrEmpty(svgContent) && !string.IsNullOrEmpty(filePath))
        {
            try
            {
                if (!filePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) filePath += ".svg";
                var directory = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                    Directory.CreateDirectory(directory);

                File.WriteAllText(filePath, svgContent);
                status = "Success: File written";
                fullPath = Path.GetFullPath(filePath);
            }
            catch (Exception ex)
            {
                status = $"Error: {ex.Message}";
                AddRuntimeMessage(GH_RuntimeMessageLevel.Error, ex.Message);
            }
        }

        DA.SetData(0, status);
        DA.SetData(1, fullPath);
    }
}
