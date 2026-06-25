// Grasshopper Script Instance
#region Usings
using System;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;

using Rhino;
using Rhino.Geometry;

using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using System.IO;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;


#endregion

public class Script_Instance : GH_ScriptInstance
{
    #region Notes
    /*
      Members:
        RhinoDoc RhinoDocument
        GH_Document GrasshopperDocument
        IGH_Component Component
        int Iteration

      Methods (Virtual & overridable):
        Print(string text)
        Print(string format, params object[] args)
        Reflect(object obj)
        Reflect(object obj, string method_name)
    */
    #endregion

    private void RunScript(
            string path,
            ref object Geometry,
            ref object BlockNames,
            ref object LayerNames)
    {
        var result = ImportFile(path);

        if (!result.Success)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error, result.ErrorMessage);
            return;
        }

        // Convert to GH goo + parallel metadata lists
        var geos = new List<IGH_GeometricGoo>();
        var blocks = new List<string>();
        var layers = new List<string>();

        foreach (var item in result.Geometry)
        {
            IGH_GeometricGoo goo = item.Geometry switch
            {
                Curve curve => new GH_Curve(curve),
                Brep brep => new GH_Brep(brep),
                Mesh mesh => new GH_Mesh(mesh),
                Surface surface => new GH_Surface(surface),
                Rhino.Geometry.Point point => new GH_Point(point.Location),
                _ => null
            };
            if (goo == null) continue;

            geos.Add(goo);
            blocks.Add(item.BlockName);
            layers.Add(item.LayerName);
        }

        Geometry = geos;
        BlockNames = blocks;
        LayerNames = layers;
    }

    // ============================================================================
    // File import
    // ============================================================================

    private const long MaxFileSizeBytes = 200 * 1024 * 1024; // adjust to taste

    private (bool Success, List<GeometryWithName> Geometry, string DetectedFormat, string ErrorMessage)
        ImportFile(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return (false, new List<GeometryWithName>(), "", "File path is empty");

        if (!File.Exists(filePath))
            return (false, new List<GeometryWithName>(), "", $"File not found: {filePath}");

        var fileInfo = new FileInfo(filePath);
        if (fileInfo.Length > MaxFileSizeBytes)
            return (false, new List<GeometryWithName>(), "",
                $"File too large: {fileInfo.Length / 1024 / 1024}MB (max {MaxFileSizeBytes / 1024 / 1024}MB)");

        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        var doc = RhinoDoc.CreateHeadless(null);
        if (doc == null)
            return (false, new List<GeometryWithName>(), "", "Failed to create Rhino document");

        try
        {
            bool importSuccess;
            switch (extension)
            {
                case ".3dm":
                    importSuccess = doc.Import(filePath);
                    break;
                case ".stp":
                case ".step":
                    importSuccess = FileStp.Read(filePath, doc, new FileStpReadOptions());
                    break;
                case ".fbx":
                    importSuccess = FileFbx.Read(filePath, doc, new FileFbxReadOptions());
                    break;
                case ".stl":
                    importSuccess = FileStl.Read(filePath, doc, new FileStlReadOptions());
                    break;
                case ".obj":
                    using (var fro = new FileReadOptions())
                        importSuccess = FileObj.Read(filePath, doc, new FileObjReadOptions(fro));
                    break;
                default:
                    importSuccess = doc.Import(filePath);
                    break;
            }

            if (!importSuccess)
                return (false, new List<GeometryWithName>(), extension,
                    $"Failed to import file with extension {extension}");

            return (true, ExtractGeometryFromDocument(doc), extension, "");
        }
        catch (Exception ex)
        {
            return (false, new List<GeometryWithName>(), extension, $"Import error: {ex.Message}");
        }
        finally
        {
            doc.Dispose();
        }
    }

    // ============================================================================
    // Geometry extraction (with recursive block explosion)
    // ============================================================================

    private List<GeometryWithName> ExtractGeometryFromDocument(RhinoDoc doc)
    {
        var geometryList = new List<GeometryWithName>();

        foreach (var obj in doc.Objects)
        {
            var layerIndex = obj.Attributes.LayerIndex;
            var layerName = layerIndex >= 0 && layerIndex < doc.Layers.Count
                ? doc.Layers[layerIndex].Name
                : "";

            if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
            {
                if (obj.Geometry is InstanceReferenceGeometry instanceGeo)
                {
                    var idef = doc.InstanceDefinitions.FindId(instanceGeo.ParentIdefId);
                    var blockName = idef?.Name ?? "Unknown Block";
                    geometryList.AddRange(
                        ExplodeInstanceRecursive(doc, instanceGeo, Transform.Identity, blockName));
                }
            }
            else
            {
                var geo = obj.Geometry.Duplicate();
                if (geo != null)
                    geometryList.Add(new GeometryWithName(geo, "No Block", layerName));
            }
        }

        return geometryList;
    }

    private List<GeometryWithName> ExplodeInstanceRecursive(RhinoDoc doc,
        InstanceReferenceGeometry instanceRef, Transform parentTransform, string parentBlockName)
    {
        var geometryList = new List<GeometryWithName>();

        var idef = doc.InstanceDefinitions.FindId(instanceRef.ParentIdefId);
        if (idef == null) return geometryList;

        var combinedTransform = parentTransform * instanceRef.Xform;

        var currentBlockName = idef.Name;
        if (!string.IsNullOrEmpty(parentBlockName) && parentBlockName != "No Block")
            currentBlockName = $"{parentBlockName}::{currentBlockName}";

        foreach (var obj in idef.GetObjects())
        {
            if (obj == null) continue;

            if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
            {
                if (obj.Geometry is InstanceReferenceGeometry nested)
                    geometryList.AddRange(
                        ExplodeInstanceRecursive(doc, nested, combinedTransform, currentBlockName));
            }
            else
            {
                var layerIndex = obj.Attributes.LayerIndex;
                var layerName = layerIndex >= 0 && layerIndex < doc.Layers.Count
                    ? doc.Layers[layerIndex].Name
                    : "";
                var geo = obj.Geometry.Duplicate();
                if (geo == null) continue;

                if (!combinedTransform.Equals(Transform.Identity))
                {
                    if (combinedTransform.SimilarityType == TransformSimilarityType.NotSimilarity)
                    {
                        if (!geo.MakeDeformable() && geo is Curve crv)
                            geo = crv.ToNurbsCurve();
                    }

                    if (!geo.Transform(combinedTransform))
                    {
                        geo.Dispose();
                        continue;
                    }

                    if (combinedTransform.SimilarityType == TransformSimilarityType.OrientationReversing)
                    {
                        if (geo is Brep brep) brep.Flip();
                        else if (geo is Mesh mesh) mesh.Flip(true, true, true);
                    }
                }

                geometryList.Add(new GeometryWithName(geo, currentBlockName, layerName));
            }
        }

        return geometryList;
    }

    public class GeometryWithName
    {
        public GeometryWithName(GeometryBase geometry, string blockName, string layerName = "")
        {
            Geometry = geometry;
            BlockName = blockName;
            LayerName = layerName;
        }
        public GeometryBase Geometry { get; set; }
        public string BlockName { get; set; }
        public string LayerName { get; set; }
    }

}
