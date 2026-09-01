using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Grasshopper.Rhinoceros.Model;
using Grasshopper.Rhinoceros.Model.Params;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.FileIO.Components;

/// <summary>
///     Exports a Rhino block instance to a base64-encoded .3dm file, recursively including nested block definitions.
/// </summary>
public class GH_BlockToFile : GH_Component, ISelvaFileOutput
{
    private static RhinoDocumentConverter _converter;
    private static readonly object _converterLock = new object();

    private readonly Dictionary<string, int> _copiedBlockIndices;

    public GH_BlockToFile()
        : base(
            "Block to File",
            "Block2File",
            "Export Rhino block instances to base64-encoded 3dm files",
            "Selva",
            "IO")
    {
        _copiedBlockIndices = new Dictionary<string, int>();
        EnsureConverterInitialized();
    }

    public override Guid ComponentGuid => new Guid("4D92D5D2-37D3-4046-A513-CED165939336");

    protected override Bitmap Icon => Resources.BlockToFile;

    public override GH_Exposure Exposure => GH_Exposure.primary;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(
            new Param_ModelObject(),
            "Block",
            "B",
            "Block instance to export",
            GH_ParamAccess.item);
        pManager.AddTextParameter("File Name", "FN", "Optional name for the exported file", GH_ParamAccess.item);
        pManager.AddTextParameter("Format", "F", "File format extension: .3dm (default) or .stp", GH_ParamAccess.item);
        pManager.AddTextParameter("Sub Folder", "Folder", "Optional subfolder for this file. Use :: to nest, like Rhino layers (ROOT::Panels). Files sharing a root land in the same folder; different roots produce separate top-level folders in the download.", GH_ParamAccess.item,
            "");
        pManager.AddTextParameter("Metadata", "M",
            "Optional metadata as \"key=value\" lines (e.g. author=felix). Rides along with the file for downstream tagging/indexing.",
            GH_ParamAccess.list);
        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter(
            "File",
            "F",
            "Exported block as base64-encoded file data",
            GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        try
        {
            if (!TryGetBlockInput(DA, out var blockObj))
            {
                return;
            }

            string fileName = null;
            if (!DA.GetData(1, ref fileName))
            {
                return;
            }

            var format = ".3dm";
            DA.GetData(2, ref format);
            format = NormalizeFormat(format);

            var subFolder = "";
            DA.GetData(3, ref subFolder);

            var metadataLines = new List<string>();
            DA.GetDataList(4, metadataLines);

            if (!IsSupportedFormat(format))
            {
                AddRuntimeMessage(
                    GH_RuntimeMessageLevel.Error,
                    $"Unsupported format '{format}'. Use .3dm or .stp");
                return;
            }

            var exportedFile = ExportBlockToFile(blockObj, fileName, format, subFolder ?? "",
                FileMetadataParser.Parse(metadataLines));

            if (exportedFile != null)
            {
                DA.SetData(0, new FileDataGoo(exportedFile));
            }
        }
        catch (Exception ex)
        {
            // Include exception type + originating frame: a bare NullReferenceException message
            // is always "Object reference not set...", giving no clue which data caused it.
            var location = ex.StackTrace?.Split('\n')[0]?.Trim();
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Error,
                $"Export failed: {ex.GetType().Name}: {ex.Message}" +
                (string.IsNullOrEmpty(location) ? "" : $" ({location})"));
        }
    }

    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    private bool TryGetBlockInput(IGH_DataAccess DA, out ModelObject blockObj)
    {
        blockObj = null;

        if (!DA.GetData(0, ref blockObj))
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                "No block provided");
            return false;
        }

        return true;
    }

    private FileData ExportBlockToFile(ModelObject blockObj, string fileName, string format, string subFolder,
        Dictionary<string, string> metadata)
    {
        using var headlessDoc = RhinoDoc.CreateHeadless(null);
        _copiedBlockIndices.Clear();

        if (!TryProcessBlockObject(blockObj, headlessDoc, out var blockName))
        {
            return null;
        }

        var base64String = ConvertDocumentToBase64(headlessDoc, format);
        if (string.IsNullOrEmpty(base64String))
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Error,
                $"Encoding the exported '{format}' file produced no data.");
            return null;
        }

        return CreateFileData(fileName, base64String, format, subFolder, metadata);
    }

    private bool TryProcessBlockObject(ModelObject blockObj, RhinoDoc targetDoc, out string blockName)
    {
        blockName = null;

        if (!blockObj.CastTo<GH_InstanceReference>(out var instanceRef))
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                "Input is not a block instance. Connect a block instance from the model.");
            return false;
        }

        var modelIdef = instanceRef.InstanceDefinition;
        if (modelIdef == null)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                "Block instance has no definition — nothing to export.");
            return false;
        }

        blockName = modelIdef.Name;
        CopyBlockRecursive(modelIdef, targetDoc);

        // No index means the definition had no exportable geometry: typically a linked/embedded
        // definition whose objects live in an external file, or an empty definition.
        if (!_copiedBlockIndices.TryGetValue(blockName, out var idefIndex))
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                $"Block '{blockName}' has no exportable geometry. Linked or embedded blocks whose " +
                "geometry lives in an external file cannot be exported directly — bind/explode the " +
                "block, or export the source geometry instead.");
            return false;
        }

        if (instanceRef.Value == null)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Warning,
                $"Block '{blockName}' has no placement transform — nothing to export.");
            return false;
        }

        var xform = instanceRef.Value.Xform;
        targetDoc.Objects.AddInstanceObject(idefIndex, xform);
        return true;
    }

    private void CopyBlockRecursive(ModelInstanceDefinition modelIdef, RhinoDoc targetDoc)
    {
        if (_copiedBlockIndices.ContainsKey(modelIdef.Name))
        {
            return;
        }

        var geometries = CollectBlockGeometry(modelIdef, targetDoc);

        if (geometries.Count == 0)
        {
            return;
        }

        var idefIndex = targetDoc.InstanceDefinitions.Add(
            modelIdef.Name,
            "",
            Point3d.Origin,
            geometries);

        if (idefIndex >= 0)
        {
            _copiedBlockIndices[modelIdef.Name] = idefIndex;
        }
    }

    private List<GeometryBase> CollectBlockGeometry(ModelInstanceDefinition modelIdef, RhinoDoc targetDoc)
    {
        var geometries = new List<GeometryBase>();

        // Objects is null (not just empty) for linked/embedded definitions whose objects aren't
        // materialized, so foreach would NRE on the null before the per-item guard runs.
        var objects = modelIdef.Objects;
        if (objects == null)
        {
            return geometries;
        }

        foreach (var modelObj in objects)
        {
            if (modelObj == null)
            {
                continue;
            }

            if (modelObj.ObjectType == ObjectType.InstanceReference)
            {
                TryAddNestedBlockReference(modelObj, targetDoc, geometries);
            }
            else if (modelObj.CastTo<GeometryBase>(out var geom) && geom != null)
            {
                geometries.Add(geom);
            }
        }

        return geometries;
    }

    private void TryAddNestedBlockReference(ModelObject modelObj, RhinoDoc targetDoc, List<GeometryBase> geometries)
    {
        if (!modelObj.CastTo<GH_InstanceReference>(out var nestedInstanceRef))
        {
            return;
        }

        var nestedModelIdef = nestedInstanceRef.InstanceDefinition;
        if (nestedModelIdef == null)
        {
            return;
        }

        CopyBlockRecursive(nestedModelIdef, targetDoc);

        if (_copiedBlockIndices.TryGetValue(nestedModelIdef.Name, out var nestedIdefIndex) &&
            nestedInstanceRef.Value != null)
        {
            // Null means a stale/invalid index: guard before accessing .Id.
            var nestedIdef = targetDoc.InstanceDefinitions[nestedIdefIndex];
            if (nestedIdef == null)
            {
                return;
            }

            var xform = nestedInstanceRef.Value.Xform;

            geometries.Add(new InstanceReferenceGeometry(nestedIdef.Id, xform));
        }
    }

    private string ConvertDocumentToBase64(RhinoDoc doc, string format)
    {
        return format == ".3dm"
            ? _converter.DocToRhinoFile(doc)
            : _converter.DocToBase64(doc, format);
    }

    private FileData CreateFileData(string fileName, string base64String, string format, string subFolder,
        Dictionary<string, string> metadata)
    {
        return new FileData
        {
            FileName = Path.GetFileNameWithoutExtension(fileName ?? string.Empty),
            Data = base64String,
            FileType = format,
            IsBase64Encoded = true,
            SubFolder = subFolder ?? "",
            Metadata = metadata ?? new Dictionary<string, string>()
        };
    }

    private static string NormalizeFormat(string format)
    {
        if (string.IsNullOrWhiteSpace(format))
        {
            return ".3dm";
        }

        format = format.Trim().ToLowerInvariant();
        if (!format.StartsWith("."))
        {
            format = "." + format;
        }

        return format;
    }

    private static bool IsSupportedFormat(string format)
    {
        return format is ".3dm" or ".stp" or ".step";
    }

    private void EnsureConverterInitialized()
    {
        if (_converter != null)
        {
            return;
        }

        lock (_converterLock)
        {
            if (_converter != null)
            {
                return;
            }

            var options = new RhinoConverterOptions();

            _converter = new RhinoDocumentConverter(options);
        }
    }
}
