using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Types;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;
using Point = Rhino.Geometry.Point;

namespace ComputeBuilder.Components.IO;

public class GH_Base64Parser : GH_Component
{
  public enum FileFormat
  {
    Rhino3dm = 1,
    Step = 2
  }

  public GH_Base64Parser()
    : base("Base64 Parser",
      "BASE64PARSER",
      "Parses a Base64 string into geometric data from various file formats.",
      "ComputeBuilder",
      "IO")
  {
  }

  protected override Bitmap Icon => null;

  public override Guid ComponentGuid => new("F7688036-191F-4277-9E87-C5CDDC92DC71");

  protected override void RegisterInputParams(GH_InputParamManager pManager)
  {
    pManager.AddTextParameter("Base64 String", "B64", "The Base64 encoded string to parse.", GH_ParamAccess.item);
    pManager.AddIntegerParameter("File Format", "F",
      "File format (0=Auto, 1=3dm, 2=STEP, 3=IGES, 4=DWG, 5=DXF, 6=OBJ, 7=STL, 8=PLY, 9=FBX)", GH_ParamAccess.item, 0);
    pManager.AddBooleanParameter("Run", "R", "Set to true to run the parser.", GH_ParamAccess.item, false);

    // Make file format optional
    pManager[1].Optional = true;
  }

  protected override void RegisterOutputParams(GH_OutputParamManager pManager)
  {
    pManager.AddGeometryParameter("Geometry", "G", "Parsed geometry objects", GH_ParamAccess.list);
    pManager.AddTextParameter("Block Names", "BN", "Block names for each geometry object", GH_ParamAccess.list);
    pManager.AddTextParameter("Layer Names", "LN", "Layer names for each geometry object", GH_ParamAccess.list);
    pManager.AddTextParameter("File Format", "FF", "Detected or specified file format", GH_ParamAccess.item);
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
    var base64String = "";
    var formatIndex = 0;
    var run = false;

    if (!DA.GetData(0, ref base64String))
    {
      return;
    }

    DA.GetData(1, ref formatIndex);
    if (!DA.GetData(2, ref run))
    {
      return;
    }

    if (!run)
    {
      return;
    }

    var format = (FileFormat)formatIndex;
    var headless = RhinoDoc.CreateHeadless(null);

    var detectedFormat = "";
    var importSuccess = ImportFromBase64(base64String, headless, format, out detectedFormat);

    if (!importSuccess)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
        $"Failed to import data from Base64 string. Format: {detectedFormat}");
      DA.SetDataList(0, new List<GeometryBase>());
      DA.SetDataList(1, new List<string>());
      DA.SetDataList(2, new List<string>());
      DA.SetData(3, detectedFormat);
      return;
    }

    var allGeometryWithNames = new List<GeometryWithName>();

    foreach (var obj in headless.Objects)
    {
      var layer = headless.Layers[obj.Attributes.LayerIndex];

      if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
      {
        var instanceGeo = obj.Geometry as InstanceReferenceGeometry;
        if (instanceGeo != null)
        {
          var idef = headless.InstanceDefinitions.FindId(instanceGeo.ParentIdefId);
          var blockName = idef?.Name ?? "Unknown Block";

          var blockGeometry = ExplodeInstanceRecursive(headless, instanceGeo, Transform.Identity, blockName);
          allGeometryWithNames.AddRange(blockGeometry);
        }
      }
      else
      {
        var geo = obj.Geometry.DuplicateShallow();
        allGeometryWithNames.Add(new GeometryWithName(geo, "No Block", layer.Name));
      }
    }

    var geometry = allGeometryWithNames.Select(g => g.Geometry).ToList();
    var blockNames = allGeometryWithNames.Select(g => g.BlockName).ToList();
    var layerNames = allGeometryWithNames.Select(g => g.LayerName).ToList();

    var ghGeometry = new List<IGH_GeometricGoo>();

    foreach (var geo in geometry)
    {
      if (geo is Curve curve)
      {
        ghGeometry.Add(new GH_Curve(curve));
      }
      else if (geo is Brep brep)
      {
        ghGeometry.Add(new GH_Brep(brep));
      }
      else if (geo is Mesh mesh)
      {
        ghGeometry.Add(new GH_Mesh(mesh));
      }
      else if (geo is Surface surface)
      {
        ghGeometry.Add(new GH_Surface(surface));
      }
      else if (geo is Point point)
      {
        ghGeometry.Add(new GH_Point(point.Location));
      }
    }

    DA.SetDataList(0, ghGeometry);
    DA.SetDataList(1, blockNames);
    DA.SetDataList(2, layerNames);
    DA.SetData(3, detectedFormat);
    headless.Dispose();
  }

  private bool ImportFromBase64(string base64Data, RhinoDoc doc, FileFormat format, out string detectedFormat)
  {
    string tempPath = null;
    detectedFormat = format.ToString();

    try
    {
      var fileData = Convert.FromBase64String(base64Data);

      // Create temp file with appropriate extension
      var extension = GetFileExtension(format);
      tempPath = Path.Combine(Path.GetTempPath(), $"temp_{Guid.NewGuid():N}{extension}");
      File.WriteAllBytes(tempPath, fileData);

      // Import based on format
      return format switch
      {
        FileFormat.Rhino3dm => Import3dm(tempPath, doc),
        FileFormat.Step => ImportStep(tempPath, doc),
        _ => false
      };
    }
    catch (Exception ex)
    {
      RhinoApp.WriteLine($"Import error: {ex.Message}");
      return false;
    }
    finally
    {
      if (!string.IsNullOrEmpty(tempPath))
      {
        try
        {
          if (File.Exists(tempPath))
          {
            File.Delete(tempPath);
          }
        }
        catch
        {
          /* ignore */
        }
      }
    }
  }

  private string GetFileExtension(FileFormat format)
  {
    return format switch
    {
      FileFormat.Rhino3dm => ".3dm",
      FileFormat.Step => ".stp",
      _ => ".tmp"
    };
  }

  private bool Import3dm(string filePath, RhinoDoc doc)
  {
    try
    {
      return doc.Import(filePath);
    }
    catch (Exception ex)
    {
      RhinoApp.WriteLine($"3DM import error: {ex.Message}");
      return false;
    }
  }

  private bool ImportStep(string filePath, RhinoDoc doc)
  {
    try
    {
      var importOptions = new FileStpReadOptions();
      return FileStp.Read(filePath, doc, importOptions);
    }
    catch (Exception ex)
    {
      RhinoApp.WriteLine($"STEP import error: {ex.Message}");
      return false;
    }
  }

  private List<GeometryWithName> ExplodeInstanceRecursive(RhinoDoc doc, InstanceReferenceGeometry instanceRef,
    Transform parentTransform, string parentBlockName)
  {
    var geometryList = new List<GeometryWithName>();

    var idef = doc.InstanceDefinitions.FindId(instanceRef.ParentIdefId);
    if (idef == null)
    {
      return geometryList;
    }

    var combinedTransform = parentTransform * instanceRef.Xform;

    var currentBlockName = idef.Name;
    if (!string.IsNullOrEmpty(parentBlockName) && parentBlockName != "No Block")
    {
      currentBlockName = $"{parentBlockName}::{currentBlockName}";
    }

    var defObjects = idef.GetObjects();

    foreach (var obj in defObjects)
    {
      if (obj == null)
      {
        continue;
      }

      var layer = doc.Layers[obj.Attributes.LayerIndex];

      if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
      {
        var nestedInstanceGeo = obj.Geometry as InstanceReferenceGeometry;
        if (nestedInstanceGeo != null)
        {
          var nestedGeometry = ExplodeInstanceRecursive(doc, nestedInstanceGeo, combinedTransform, currentBlockName);
          geometryList.AddRange(nestedGeometry);
        }
      }
      else
      {
        var geo = obj.Geometry.Duplicate();

        if (geo != null)
        {
          if (!combinedTransform.Equals(Transform.Identity))
          {
            if (combinedTransform.SimilarityType == TransformSimilarityType.NotSimilarity)
            {
              if (!geo.MakeDeformable() && geo.ObjectType == ObjectType.Curve)
              {
                if (geo is Curve crv)
                {
                  geo = crv.ToNurbsCurve();
                }
              }
            }

            var transformSuccess = geo.Transform(combinedTransform);
            if (!transformSuccess)
            {
              continue;
            }

            if (combinedTransform.SimilarityType == TransformSimilarityType.OrientationReversing)
            {
              if (geo.ObjectType == ObjectType.Brep && geo is Brep brep)
              {
                brep.Flip();
              }
              else if (geo.ObjectType == ObjectType.Mesh && geo is Mesh mesh)
              {
                mesh.Flip(true, true, true);
              }
            }
          }

          geometryList.Add(new GeometryWithName(geo, currentBlockName, layer.Name));
        }
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
