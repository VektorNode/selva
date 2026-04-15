using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Geometry;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     Component that converts geometry to displayable format for web viewing.
/// </summary>
public class OBSOLETE_WebDisplay_UntilV0_5_0 : GH_TaskCapableComponent<WebDisplayGoo>
{
    public OBSOLETE_WebDisplay_UntilV0_5_0()
        : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override Guid ComponentGuid => new Guid("FCBBE140-D11C-4AA2-97E2-9DA0559CF0DF");
    public override GH_Exposure Exposure => GH_Exposure.hidden;

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGenericParameter("Geo", "G", "Geometry to display", GH_ParamAccess.tree);
        pManager.AddTextParameter("Mesh Name", "N", "Name of the mesh", GH_ParamAccess.tree, "");
        pManager.AddTextParameter("Metadata", "D", "Metadata for the mesh (Format: 'Key=Value')", GH_ParamAccess.tree);
        pManager.AddGenericParameter("T-Material", "TM", "ThreeMaterial for display", GH_ParamAccess.tree);
        pManager.AddParameter(new Param_MeshParameters(), "Meshing Settings", "MS",
            "Meshing settings to use. Default is FastRenderMesh.", GH_ParamAccess.item);

        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
    }

    /// <summary>
    ///     Creates custom component attributes
    /// </summary>
    public override void CreateAttributes()
    {
        m_attributes = new GH_ContextBakeOutputAttributes(this);
    }

    protected override void RegisterOutputParams(GH_OutputParamManager pManager)
    {
        pManager.AddGenericParameter("Web Display", "WD", "Geometry data for web display", GH_ParamAccess.item);
    }

    protected override void SolveInstance(IGH_DataAccess DA)
    {
        GH_Structure<IGH_Goo> geoTree;
        GH_Structure<GH_String> nameTree;
        GH_Structure<GH_String> metadataTree;
        GH_Structure<IGH_Goo> materialTree;
        GH_MeshingParameters meshingParameters = null;

        if (!DA.GetDataTree(0, out geoTree) || geoTree.IsEmpty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
            return;
        }

        DA.GetDataTree(1, out nameTree);
        DA.GetDataTree(2, out metadataTree);
        DA.GetDataTree(3, out materialTree);
        DA.GetData(4, ref meshingParameters);

        var meshSettings = meshingParameters?.Value ?? MeshingParameters.FastRenderMesh;
        var allGeo = geoTree.FlattenData().ToList();
        var allNames = nameTree?.FlattenData().ToList() ?? new List<GH_String>();
        var allMetadata = metadataTree?.FlattenData().ToList() ?? new List<GH_String>();
        var allMaterials = materialTree?.FlattenData().ToList() ?? new List<IGH_Goo>();

        if (InPreSolve)
        {
            var task = Task.Run(() => Compute(allGeo, allNames, allMetadata, allMaterials, meshSettings), CancelToken);
            TaskList.Add(task);
            return;
        }

        if (!GetSolveResults(DA, out var batch))
        {
            batch = Compute(allGeo, allNames, allMetadata, allMaterials, meshSettings);
        }

        if (batch == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Failed to generate valid geometry for display");
            return;
        }

        DA.SetData(0, batch);
    }

    private WebDisplayGoo Compute(
        List<IGH_Goo> geoGoos,
        List<GH_String> nameGoos,
        List<GH_String> metadataGoos,
        List<IGH_Goo> materialGoos,
        MeshingParameters meshSettings)
    {
        try
        {
            var stopwatch = Stopwatch.StartNew();

            // Extract geometries
            var geometries = ExtractGeometries(geoGoos);

            if (geometries.Count == 0)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"No valid geometry found in {geoGoos.Count} input items. Ensure geometry is valid.");
                return null;
            }

            // Convert to meshes
            var meshes = ConvertToMeshesParallel(geometries, meshSettings);

            if (meshes.Count == 0)
            {
                AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                    $"No meshes could be generated from {geometries.Count} geometry items. Check geometry validity and meshing parameters.");
                return null;
            }

            if (meshes.Count < geometries.Count)
            {
                var skipped = geometries.Count - meshes.Count;
                AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
                    $"Successfully meshed {meshes.Count} of {geometries.Count} geometries ({skipped} skipped)");
            }

            // Prepare names and materials
            var names = PrepareNames(meshes.Count, nameGoos);
            var metadata = PrepareMetadata(meshes.Count, metadataGoos);
            var materials = PrepareMaterials(meshes.Count, materialGoos);

            // Create batch
            var batch = MeshBatchProcessor.CreateBatch(meshes, names, materials, metadata);


            return new WebDisplayGoo(batch);
        }
        catch (Exception ex)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
                $"Failed to process geometry: {ex.Message}");
            return null;
        }
    }

    #region Geometry Extraction

    private List<GeometryBase> ExtractGeometries(List<IGH_Goo> gooList)
    {
        if (gooList == null || gooList.Count == 0)
        {
            return new List<GeometryBase>();
        }

        var geometries = new ConcurrentBag<(int Index, GeometryBase Geometry)>();

        Parallel.For(0, gooList.Count, i =>
        {
            try
            {
                var goo = gooList[i];
                var geom = TryExtractGeometry(goo);
                if (geom != null && geom.IsValid)
                {
                    geometries.Add((i, geom));
                }
            }
            catch
            {
                // Silently skip invalid items in parallel processing
            }
        });

        return geometries.OrderBy(x => x.Index).Select(x => x.Geometry).ToList();
    }

    private GeometryBase TryExtractGeometry(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        if (goo.ScriptVariable() is GeometryBase geomBase)
        {
            return geomBase;
        }

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

    private List<Mesh> ConvertToMeshesParallel(List<GeometryBase> geometries, MeshingParameters meshSettings)
    {
        if (geometries == null || geometries.Count == 0)
        {
            return new List<Mesh>();
        }

        var meshDict = new ConcurrentDictionary<int, Mesh>();

        Parallel.For(0, geometries.Count, index =>
        {
            try
            {
                var mesh = ConvertSingleGeometry(geometries[index], meshSettings);
                if (mesh != null && mesh.IsValid)
                {
                    meshDict.TryAdd(index, mesh);
                }
            }
            catch
            {
                // Silently skip invalid geometry in parallel processing
            }
        });

        return meshDict.OrderBy(kvp => kvp.Key).Select(kvp => kvp.Value).ToList();
    }

    private Mesh ConvertSingleGeometry(GeometryBase geom, MeshingParameters mParams)
    {
        if (geom == null || !geom.IsValid)
        {
            return null;
        }

        try
        {
            var mesh = geom switch
            {
                Mesh existingMesh => existingMesh.DuplicateMesh(),
                Brep brep => CreateMeshFromBrep(brep, mParams),
                Surface surface => Mesh.CreateFromSurface(surface, mParams),
                Curve => null, // Curves cannot be meshed
                _ => null
            };

            if (mesh != null && mesh.IsValid)
            {
                mesh.Normals.ComputeNormals();
                mesh.Compact();
                return mesh;
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private Mesh CreateMeshFromBrep(Brep brep, MeshingParameters mParams)
    {
        if (brep == null || !brep.IsValid)
        {
            return null;
        }

        try
        {
            var meshArray = Mesh.CreateFromBrep(brep, mParams);
            if (meshArray == null || meshArray.Length == 0)
            {
                return null;
            }

            var mesh = new Mesh();
            foreach (var m in meshArray)
            {
                if (m != null && m.IsValid)
                {
                    mesh.Append(m);
                }
            }

            return mesh.Faces.Count > 0 ? mesh : null;
        }
        catch
        {
            return null;
        }
    }

    #endregion

    #region Input Data Preparation

    private List<string> PrepareNames(int count, List<GH_String> nameGoos)
    {
        var names = nameGoos?
            .Select(n => n?.Value)
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .ToList() ?? new List<string>();

        return NormalizeList(names, count, i => i.ToString());
    }

    private List<Dictionary<string, string>> PrepareMetadata(int count, List<GH_String> metadataGoos)
    {
        var metadataList = metadataGoos?
            .Select(m => ParseMetadataString(m?.Value))
            .ToList() ?? new List<Dictionary<string, string>>();

        return NormalizeList(metadataList, count, _ => new Dictionary<string, string>());
    }

    private Dictionary<string, string> ParseMetadataString(string metadataString)
    {
        var metadata = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(metadataString))
        {
            return metadata;
        }

        var pairs = metadataString.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
        foreach (var pair in pairs)
        {
            var parts = pair.Split(new[] { '=' }, 2);
            if (parts.Length == 2)
            {
                metadata[parts[0].Trim()] = parts[1].Trim();
            }
        }

        return metadata;
    }

    private List<ThreeMaterial> PrepareMaterials(int count, List<IGH_Goo> materialGoos)
    {
        var materials = new List<ThreeMaterial>();

        foreach (var goo in materialGoos ?? new List<IGH_Goo>())
        {
            var material = ExtractMaterial(goo);
            if (material != null)
            {
                materials.Add(material);
            }
        }

        return NormalizeList(materials, count, _ => ThreeMaterial.Default());
    }

    private ThreeMaterial ExtractMaterial(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        if (goo.ScriptVariable() is ThreeMaterial mat)
        {
            return mat;
        }

        if (goo is GH_ObjectWrapper wrapper && wrapper.Value is ThreeMaterial wrapMat)
        {
            return wrapMat;
        }

        return null;
    }

    private List<T> NormalizeList<T>(List<T> input, int targetCount, Func<int, T> defaultFactory)
    {
        if (input.Count == 0)
        {
            return Enumerable.Range(0, targetCount).Select(defaultFactory).ToList();
        }

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
