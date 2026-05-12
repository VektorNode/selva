using System;
using System.Collections.Generic;
using System.Drawing;
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

namespace Selva.GH.Features.FileIO.OBSOLETE;

/// <summary>
///     Exports Rhino block instances to base64-encoded .3dm files.
///     Supports recursive block hierarchies by automatically including nested block definitions.
/// </summary>
public class OBSOLETE_BlockToFile_UntilV0_6_2 : GH_Component, ISelvaFileOutput
{
    private static RhinoDocumentConverter _converter;
    private static readonly object _converterLock = new object();

    private readonly Dictionary<string, int> _copiedBlockIndices;

    public OBSOLETE_BlockToFile_UntilV0_6_2()
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

    public override Guid ComponentGuid => new Guid("06308887-AADB-40EE-A6A8-9CC8E05900EB");

    protected override Bitmap Icon => Resources.BlockToFile;

    public override GH_Exposure Exposure => GH_Exposure.hidden;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddParameter(
            new Param_ModelObject(),
            "Block",
            "B",
            "Block instance to export",
            GH_ParamAccess.item);
        pManager.AddTextParameter("File Name", "FN", "Optional name for the exported file", GH_ParamAccess.item);
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

            var exportedFile = ExportBlockToFile(blockObj, fileName);

            if (exportedFile != null)
            {
                DA.SetData(0, new FileDataGoo(exportedFile));
            }
            else
            {
                AddRuntimeMessage(
                    GH_RuntimeMessageLevel.Error,
                    "Failed to export block to file");
            }
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(
                GH_RuntimeMessageLevel.Error,
                $"Export failed: {ex.Message}");
        }
    }

    /// <summary>
    ///     Creates custom component attributes
    /// </summary>
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

    private FileData ExportBlockToFile(ModelObject blockObj, string fileName)
    {
        using var headlessDoc = RhinoDoc.CreateHeadless(null);
        _copiedBlockIndices.Clear();


        if (!TryProcessBlockObject(blockObj, headlessDoc, out var blockName))
        {
            return null;
        }

        var base64String = ConvertDocumentToBase64(headlessDoc);
        if (string.IsNullOrEmpty(base64String))
        {
            return null;
        }

        return CreateFileData(fileName, base64String);
    }

    private bool TryProcessBlockObject(ModelObject blockObj, RhinoDoc targetDoc, out string blockName)
    {
        blockName = null;

        if (!blockObj.CastTo<GH_InstanceReference>(out var instanceRef))
        {
            return false;
        }

        var modelIdef = instanceRef.InstanceDefinition;
        if (modelIdef == null)
        {
            return false;
        }

        blockName = modelIdef.Name;
        CopyBlockRecursive(modelIdef, targetDoc);

        if (_copiedBlockIndices.TryGetValue(blockName, out var idefIndex) &&
            instanceRef.Value != null)
        {
            var xform = instanceRef.Value.Xform;
            targetDoc.Objects.AddInstanceObject(idefIndex, xform);
            return true;
        }

        return false;
    }

    private void CopyBlockRecursive(ModelInstanceDefinition modelIdef, RhinoDoc targetDoc)
    {
        // Skip if already copied
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

        foreach (var modelObj in modelIdef.Objects)
        {
            if (modelObj == null)
            {
                continue;
            }

            if (modelObj.ObjectType == ObjectType.InstanceReference)
            {
                TryAddNestedBlockReference(modelObj, targetDoc, geometries);
            }
            else if (modelObj.CastTo<GeometryBase>(out var geom))
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

        // Recursively copy nested block first
        CopyBlockRecursive(nestedModelIdef, targetDoc);

        if (_copiedBlockIndices.TryGetValue(nestedModelIdef.Name, out var nestedIdefIndex) &&
            nestedInstanceRef.Value != null)
        {
            var nestedIdef = targetDoc.InstanceDefinitions[nestedIdefIndex];
            var xform = nestedInstanceRef.Value.Xform;

            geometries.Add(new InstanceReferenceGeometry(nestedIdef.Id, xform));
        }
    }

    private string ConvertDocumentToBase64(RhinoDoc doc)
    {
        return _converter.DocToRhinoFile(doc);
    }

    private FileData CreateFileData(string fileName, string base64String)
    {
        return new FileData
        {
            FileName = fileName,
            Data = base64String,
            FileType = ".3dm",
            IsBase64Encoded = true
        };
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
