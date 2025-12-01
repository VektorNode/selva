using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.Features.Display.Services;

namespace Selva.Features.Display.Components;

/// <summary>
///   Component that converts geometry to displayable format for web viewing.
/// </summary>
public class WebDisplay : GH_TaskCapableComponent<DisplayResults>
{
  private const string DefaultMeshPrefix = "";

  public WebDisplay()
    : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
  {
  }

  protected override Bitmap Icon => null;
  public override Guid ComponentGuid => new("3B108239-0103-4D4B-8407-534A78811090");

  protected override void RegisterInputParams(GH_InputParamManager pManager)
  {
    pManager.AddGenericParameter("Geo", "G", "Geometry to display", GH_ParamAccess.tree);
    pManager.AddTextParameter("Mesh Name", "N", "Name of the mesh", GH_ParamAccess.tree, "");
    pManager.AddGenericParameter("Three Material", "TM", "ThreeMaterial for display", GH_ParamAccess.tree);
    pManager.AddParameter(new Param_MeshParameters(), "Meshing Settings", "MS",
      "Meshing settings to use. Default is FastRenderMesh.", GH_ParamAccess.item);

    pManager[2].Optional = true;
    pManager[3].Optional = true;
  }

  protected override void RegisterOutputParams(GH_OutputParamManager pManager)
  {
    pManager.AddGenericParameter("WebDisplay", "WD", "Geometry data for web display", GH_ParamAccess.list);
  }

  protected override void SolveInstance(IGH_DataAccess DA)
  {
    // Get data trees
    GH_Structure<IGH_Goo> geoTree;
    GH_Structure<GH_String> nameTree;
    GH_Structure<IGH_Goo> materialTree;
    GH_MeshingParameters meshingParameters = null;

    if (!DA.GetDataTree(0, out geoTree) || geoTree.IsEmpty)
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
      return;
    }

    DA.GetDataTree(1, out nameTree);
    DA.GetDataTree(2, out materialTree);
    DA.GetData(3, ref meshingParameters);

    if (InPreSolve)
    {
      var task = Task.Run(() =>
      {
        var meshSettings = meshingParameters?.Value ?? MeshingParameters.FastRenderMesh;
        var allGeo = geoTree.FlattenData().ToList();
        var allNames = nameTree?.FlattenData().ToList() ?? new List<GH_String>();
        var allMaterials = materialTree?.FlattenData().ToList() ?? new List<IGH_Goo>();

        return Compute(allGeo, allNames, allMaterials, meshSettings);
      }, CancelToken);

      TaskList.Add(task);
      return;
    }

    if (!GetSolveResults(DA, out var result))
    {
      var meshSettings = meshingParameters?.Value ?? MeshingParameters.FastRenderMesh;
      var allGeo = geoTree.FlattenData().ToList();
      var allNames = nameTree?.FlattenData().ToList() ?? new List<GH_String>();
      var allMaterials = materialTree?.FlattenData().ToList() ?? new List<IGH_Goo>();

      result = Compute(allGeo, allNames, allMaterials, meshSettings);
    }

    if (!string.IsNullOrEmpty(result.Error))
    {
      AddRuntimeMessage(GH_RuntimeMessageLevel.Error, result.Error);
      return;
    }

    if (result.Warnings.Any())
      foreach (var warning in result.Warnings)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, warning);
      }

    if (result.Remarks.Any())
      foreach (var remark in result.Remarks)
      {
        AddRuntimeMessage(GH_RuntimeMessageLevel.Remark, remark);
      }

    DA.SetDataList(0, result.Displays);
  }

  private DisplayResults Compute(
    List<IGH_Goo> geoGoos,
    List<GH_String> nameGoos,
    List<IGH_Goo> materialGoos,
    MeshingParameters meshSettings)
  {
    var result = new DisplayResults();

    try
    {
      var geometries = ExtractGeometries(geoGoos, result.Warnings);
      if (geometries.Count == 0)
      {
        result.Error = "No valid geometry found in input";
        return result;
      }

      var meshes = ConvertToMeshesParallel(geometries, meshSettings, result.Warnings);
      var names = PrepareNames(geometries.Count, nameGoos);
      var materials = PrepareMaterials(geometries.Count, materialGoos);

      var validMeshes = new List<Mesh>();
      var validNames = new List<string>();
      var validMaterials = new List<ThreeMaterial>();

      for (var i = 0; i < meshes.Count; i++)
      {
        if (meshes[i] != null && meshes[i].IsValid)
        {
          validMeshes.Add(meshes[i]);
          validNames.Add(names[i]);
          validMaterials.Add(materials[i]);
        }
      }

      if (validMeshes.Count == 0)
      {
        result.Error = "No valid meshes generated from input geometry";
        return result;
      }

      // Create optimized batch
      var batch = MeshBatchProcessor.CreateBatch(validMeshes, validNames, validMaterials);
      result.Displays.Add(new WebDisplayGoo(batch));

      if (validMeshes.Count != geometries.Count)
        result.Warnings.Add($"Successfully processed {validMeshes.Count} out of {geometries.Count} geometries.");

      // Add statistics as remarks
      result.Remarks.Add($"Optimized: {validMeshes.Count} meshes, {batch.Materials.Count} unique materials, {batch.Groups.Count} material groups");
    }
    catch (Exception ex)
    {
      result.Error = $"Error processing geometry: {ex.Message}";
    }

    return result;
  }

  #region Geometry Extraction

  private List<GeometryBase> ExtractGeometries(List<IGH_Goo> gooList, List<string> warnings)
  {
    var geometries = new ConcurrentBag<(int Index, GeometryBase Geometry)>();

    Parallel.For(0, gooList.Count, i =>
    {
      var goo = gooList[i];
      var geom = TryExtractGeometry(goo);
      if (geom != null && geom.IsValid)
        geometries.Add((i, geom));
      else if (goo != null)
        lock (warnings)
        {
          warnings.Add($"Could not extract valid geometry from: {goo.TypeName ?? "null"}");
        }
    });

    return geometries.OrderBy(x => x.Index).Select(x => x.Geometry).ToList();
  }

  private GeometryBase TryExtractGeometry(IGH_Goo goo)
  {
    if (goo == null) return null;

    if (goo.ScriptVariable() is GeometryBase geomBase) return geomBase;

    return goo switch
    {
      GH_GeometricGoo<GeometryBase> ghGeom => ghGeom.Value,
      GH_Mesh ghMesh => ghMesh.Value,
      GH_Brep ghBrep => ghBrep.Value,
      GH_Surface ghSurface => ghSurface.Value,
      GH_Curve ghCurve => ghCurve.Value,
      GH_Box ghBox when ghBox.Value.IsValid => ghBox.Value.ToBrep(),
      _ => null
    };
  }

  #endregion

  #region Mesh Conversion

  private List<Mesh> ConvertToMeshesParallel(List<GeometryBase> geometries, MeshingParameters meshSettings,
    List<string> warnings)
  {
    var meshDict = new ConcurrentDictionary<int, Mesh>();

    Parallel.For(0, geometries.Count, index =>
    {
      var mesh = ConvertSingleGeometry(geometries[index], index, meshSettings, warnings);
      if (mesh != null) meshDict.TryAdd(index, mesh);
    });

    return meshDict.OrderBy(kvp => kvp.Key).Select(kvp => kvp.Value).ToList();
  }

  private Mesh ConvertSingleGeometry(GeometryBase geom, int index, MeshingParameters mParams, List<string> warnings)
  {
    if (geom == null || !geom.IsValid)
    {
      lock (warnings)
      {
        warnings.Add($"Invalid geometry at index {index}");
      }

      return null;
    }

    try
    {
      var mesh = geom switch
      {
        Mesh existingMesh => existingMesh.DuplicateMesh(),
        Brep brep => CreateMeshFromBrep(brep, mParams),
        Surface surface => Mesh.CreateFromSurface(surface, mParams),
        Curve => HandleCurve(index, warnings),
        _ => null
      };

      return FinalizeMesh(mesh, index, warnings);
    }
    catch (Exception ex)
    {
      lock (warnings)
      {
        warnings.Add($"Error converting geometry at index {index}: {ex.Message}");
      }

      return null;
    }
  }

  private Mesh CreateMeshFromBrep(Brep brep, MeshingParameters mParams)
  {
    var meshArray = Mesh.CreateFromBrep(brep, mParams);
    if (meshArray == null || meshArray.Length == 0) return null;

    var mesh = new Mesh();
    foreach (var m in meshArray)
    {
      mesh.Append(m);
    }

    return mesh;
  }

  private Mesh HandleCurve(int index, List<string> warnings)
  {
    lock (warnings)
    {
      warnings.Add($"Curves cannot be directly converted to mesh at index {index}. Consider using a pipe or sweep.");
    }

    return null;
  }

  private Mesh FinalizeMesh(Mesh mesh, int index, List<string> warnings)
  {
    if (mesh == null || !mesh.IsValid)
    {
      lock (warnings)
      {
        warnings.Add($"Failed to create valid mesh from geometry at index {index}");
      }

      return null;
    }

    mesh.Normals.ComputeNormals();
    mesh.Compact();
    return mesh;
  }

  #endregion

  #region Input Data Preparation

  private List<string> PrepareNames(int count, List<GH_String> nameGoos)
  {
    var names = nameGoos?
      .Select(n => n?.Value)
      .Where(n => !string.IsNullOrWhiteSpace(n))
      .ToList() ?? new List<string>();

    return NormalizeList(names, count, i => $"{DefaultMeshPrefix}{i}");
  }

  private List<ThreeMaterial> PrepareMaterials(int count, List<IGH_Goo> materialGoos)
  {
    var materials = new List<ThreeMaterial>();

    foreach (var goo in materialGoos ?? new List<IGH_Goo>())
    {
      var material = ExtractMaterial(goo);
      if (material != null) materials.Add(material);
    }

    return NormalizeList(materials, count, _ => ThreeMaterial.Default());
  }

  private ThreeMaterial ExtractMaterial(IGH_Goo goo)
  {
    if (goo == null) return null;

    if (goo.ScriptVariable() is ThreeMaterial mat) return mat;

    if (goo is GH_ObjectWrapper wrapper && wrapper.Value is ThreeMaterial wrapMat) return wrapMat;

    return null;
  }

  private List<T> NormalizeList<T>(List<T> input, int targetCount, Func<int, T> defaultFactory)
  {
    if (input.Count == 0) return Enumerable.Range(0, targetCount).Select(defaultFactory).ToList();

    var result = new List<T>(targetCount);
    var lastItem = input.Last();

    for (var i = 0; i < targetCount; i++)
    {
      result.Add(i < input.Count ? input[i] : lastItem);
    }

    return result;
  }

  #endregion
}
