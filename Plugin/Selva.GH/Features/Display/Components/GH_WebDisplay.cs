using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Components;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Display;
using Rhino.Geometry;
using Rhino.Render;
using Selva.GH.Features.Display.Goos;
using Selva.GH.Features.Display.Params;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Display.Components;

// Result of the single background task: all items batched together.
public sealed class SolveResult
{
    public SolveResult(List<Mesh> meshes, List<string> names, List<string> layers,
        List<Dictionary<string, string>> metadata, List<ThreeMaterial> materials, int skipped = 0)
    {
        Meshes = meshes;
        Names = names;
        Layers = layers;
        Metadata = metadata;
        Materials = materials;
        Skipped = skipped;
    }

    public List<Mesh> Meshes { get; }
    public List<string> Names { get; }
    public List<string> Layers { get; }
    public List<Dictionary<string, string>> Metadata { get; }
    public List<ThreeMaterial> Materials { get; }
    public int Skipped { get; }
}

/// <summary>
///     Component that converts geometry to a single batched WebDisplay output.
///     Reads all inputs as trees so SolveInstance is called exactly once,
///     queuing a single background task. Viewport preview is built in AfterSolveInstance.
/// </summary>
public class WebDisplay : GH_TaskCapableComponent<SolveResult>
{
    private BoundingBox _previewBB;
    private List<GH_CustomPreviewItem> _previewItems;

    public WebDisplay()
        : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override Guid ComponentGuid => new Guid("4F7A9C2E-1B3D-4E8F-A6C0-9D2E5B7F1A4C");
    public override BoundingBox ClippingBox => _previewBB;
    public override bool IsPreviewCapable => true;

    public override void ClearData()
    {
        base.ClearData();
        _previewItems = null;
        _previewBB = BoundingBox.Empty;
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGeometryParameter("Geo", "G", "Geometry to display", GH_ParamAccess.tree);
        pManager.AddTextParameter("Name", "N", "Name of the mesh", GH_ParamAccess.tree, "");
        pManager.AddTextParameter("Layer", "L", "Layer for grouping in scene manager (e.g. 'Structure/Walls')",
            GH_ParamAccess.tree, "");
        pManager.AddTextParameter("Metadata", "D", "Metadata for the mesh (Format: 'Key=Value')", GH_ParamAccess.tree);
        pManager.AddParameter(new Param_ThreeMaterial("T-Material", "TM", "ThreeMaterial for display", "Selva",
            "Display", GH_ParamAccess.tree));
        pManager.AddParameter(new Param_MeshParameters(), "Meshing Settings", "MS",
            "Meshing settings to use. Default is FastRenderMesh.", GH_ParamAccess.item);

        pManager[2].Optional = true;
        pManager[3].Optional = true;
        pManager[4].Optional = true;
        pManager[5].Optional = true;
    }

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
        GH_Structure<IGH_GeometricGoo> geoTree;
        if (!DA.GetDataTree(0, out geoTree) || geoTree.IsEmpty)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
            return;
        }

        DA.GetDataTree(1, out GH_Structure<GH_String> nameTree);
        DA.GetDataTree(2, out GH_Structure<GH_String> layerTree);
        DA.GetDataTree(3, out GH_Structure<GH_String> metaTree);
        DA.GetDataTree(4, out GH_Structure<ThreeMaterialGoo> matTree);
        GH_MeshingParameters ghMeshParams = null;
        DA.GetData(5, ref ghMeshParams);

        var meshSettings = ghMeshParams?.Value ?? MeshingParameters.FastRenderMesh;
        var componentId = InstanceGuid.ToString();

        if (InPreSolve)
        {
            TaskList.Add(Task.Run(() =>
                    ComputeBatch(geoTree, nameTree, layerTree, metaTree, matTree, meshSettings),
                CancelToken));
            return;
        }

        if (!GetSolveResults(DA, out var result))
        {
            result = ComputeBatch(geoTree, nameTree, layerTree, metaTree, matTree, meshSettings);
        }

        if (result == null || result.Meshes.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid geometry could be meshed");
            return;
        }

        if (result.Skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{result.Skipped} item(s) could not be meshed and were skipped");
        }

        var batch = MeshBatchProcessor.CreateBatch(
            result.Meshes, result.Names, result.Materials, result.Metadata,
            result.Layers, componentId);
        DA.SetData(0, new WebDisplayGoo(batch));

        // Build preview items on main thread (Rhino display API requirement).
        _previewItems = new List<GH_CustomPreviewItem>(result.Meshes.Count);
        _previewBB = BoundingBox.Empty;
        var matCache = new Dictionary<uint, DisplayMaterial>();

        for (var i = 0; i < result.Meshes.Count; i++)
        {
            var mesh = result.Meshes[i];
            var mat = result.Materials[i];

            var ghMat = new GH_Material(mat.Color);
            var renderMat = ghMat.MaterialBestGuess();
            var renderHash = renderMat.RenderHash;

            if (!matCache.TryGetValue(renderHash, out var dispMat))
            {
                var rhinoMat = renderMat.ToMaterial(RenderTexture.TextureGeneration.Disallow);
                dispMat = new DisplayMaterial(rhinoMat)
                {
                    Transparency = 1.0 - mat.Opacity,
                    IsTwoSided = true
                };
                matCache[renderHash] = dispMat;
            }

            _previewItems.Add(new GH_CustomPreviewItem
            {
                Geometry = new GH_Mesh(mesh),
                Shader = dispMat,
                Colour = dispMat.Diffuse
            });
            _previewBB.Union(mesh.GetBoundingBox(false));
        }
    }

    private static List<T> ResolveBranch<T>(IGH_Structure tree, GH_Path path) where T : class
    {
        if (tree == null)
        {
            return new List<T>();
        }

        var branch = tree.get_Branch(path)?.Cast<T>().ToList();
        if (branch != null && branch.Count > 0)
        {
            return branch;
        }

        var fallback = tree.get_Branch(new GH_Path(0))?.Cast<T>().ToList();
        return fallback ?? new List<T>();
    }

    private static SolveResult ComputeBatch(
        GH_Structure<IGH_GeometricGoo> geoTree,
        GH_Structure<GH_String> nameTree,
        GH_Structure<GH_String> layerTree,
        GH_Structure<GH_String> metaTree,
        GH_Structure<ThreeMaterialGoo> matTree,
        MeshingParameters meshSettings)
    {
        var meshes = new List<Mesh>();
        var names = new List<string>();
        var layers = new List<string>();
        var metadata = new List<Dictionary<string, string>>();
        var materials = new List<ThreeMaterial>();
        var skipped = 0;

        foreach (var path in geoTree.Paths)
        {
            var geoItems = geoTree.get_Branch(path)?.Cast<IGH_GeometricGoo>().ToList();
            if (geoItems == null || geoItems.Count == 0)
            {
                continue;
            }

            var nameItems = ResolveBranch<GH_String>(nameTree, path);
            var layerItems = ResolveBranch<GH_String>(layerTree, path);
            var metaItems = ResolveBranch<GH_String>(metaTree, path);
            var matItems = ResolveBranch<ThreeMaterialGoo>(matTree, path);

            var lastName = nameItems.Count > 0 ? nameItems[nameItems.Count - 1]?.Value ?? "" : "";
            var lastLayer = layerItems.Count > 0 ? layerItems[layerItems.Count - 1]?.Value ?? "" : "";
            var lastMeta = metaItems.Count > 0 ? metaItems[metaItems.Count - 1]?.Value ?? "" : "";
            var lastMat = matItems.Count > 0
                ? matItems[matItems.Count - 1]?.Value ?? ThreeMaterial.Default()
                : ThreeMaterial.Default();

            for (var i = 0; i < geoItems.Count; i++)
            {
                var geom = TryExtractGeometry(geoItems[i]);
                if (geom == null || !geom.IsValid)
                {
                    skipped++;
                    continue;
                }

                var mesh = ConvertSingleGeometry(geom, meshSettings);
                if (mesh == null || !mesh.IsValid)
                {
                    skipped++;
                    continue;
                }

                mesh.Normals.ComputeNormals();
                mesh.Compact();

                var nameStr = i < nameItems.Count ? nameItems[i]?.Value ?? lastName : lastName;
                var layerStr = i < layerItems.Count ? layerItems[i]?.Value ?? lastLayer : lastLayer;
                var mat = i < matItems.Count ? matItems[i]?.Value ?? lastMat : lastMat;

                // If there are more metadata items than geo items, merge all extras into this mesh.
                // This handles the case where one branch has one mesh but multiple metadata strings.
                var mergedMeta = new Dictionary<string, string>();
                if (metaItems.Count > geoItems.Count)
                {
                    foreach (var m in metaItems)
                    {
                        if (m?.Value != null)
                        {
                            foreach (var kv in ParseMetadataString(m.Value))
                            {
                                mergedMeta[kv.Key] = kv.Value;
                            }
                        }
                    }
                }
                else
                {
                    var metaStr = i < metaItems.Count ? metaItems[i]?.Value ?? lastMeta : lastMeta;
                    mergedMeta = ParseMetadataString(metaStr);
                }

                meshes.Add(mesh);
                names.Add(!string.IsNullOrWhiteSpace(nameStr) ? nameStr : meshes.Count.ToString());
                layers.Add(layerStr ?? "");
                metadata.Add(mergedMeta);
                materials.Add(mat);
            }
        }

        return meshes.Count > 0 ? new SolveResult(meshes, names, layers, metadata, materials, skipped) : null;
    }


    public override void DrawViewportMeshes(IGH_PreviewArgs args)
    {
        if (Locked || _previewItems == null)
        {
            return;
        }

        if (Attributes.Selected)
        {
            var sel = new GH_PreviewMeshArgs(args.Viewport, args.Display,
                args.ShadeMaterial_Selected, args.MeshingParameters);
            foreach (var item in _previewItems)
            {
                item.Geometry.DrawViewportMeshes(sel);
            }
        }
        else
        {
            foreach (var item in _previewItems)
            {
                item.Geometry.DrawViewportMeshes(new GH_PreviewMeshArgs(
                    args.Viewport, args.Display, item.Shader, args.MeshingParameters));
            }
        }
    }

    public override void DrawViewportWires(IGH_PreviewArgs args)
    {
        if (Locked || _previewItems == null)
        {
            return;
        }

        foreach (var item in _previewItems)
        {
            item.Geometry.DrawViewportWires(new GH_PreviewWireArgs(
                args.Viewport, args.Display,
                Attributes.Selected ? args.WireColour_Selected : args.WireColour,
                args.DefaultCurveThickness));
        }
    }


    private static GeometryBase TryExtractGeometry(IGH_Goo goo)
    {
        if (goo == null)
        {
            return null;
        }

        if (goo.ScriptVariable() is GeometryBase g)
        {
            return g;
        }

        return goo switch
        {
            GH_GeometricGoo<GeometryBase> x => x.Value,
            GH_Mesh x => x.Value,
            GH_Brep x => x.Value,
            GH_Surface x => x.Value,
            GH_Curve x => x.Value,
            GH_Box x when x.Value.IsValid => x.Value.ToBrep(),
            _ => null
        };
    }

    private static Mesh ConvertSingleGeometry(GeometryBase geom, MeshingParameters mParams)
    {
        if (geom == null || !geom.IsValid)
        {
            return null;
        }

        try
        {
            var mesh = geom switch
            {
                Mesh m => m.DuplicateMesh(),
                Brep b => CreateMeshFromBrep(b, mParams),
                Surface s => Mesh.CreateFromSurface(s, mParams),
                _ => null
            };
            return mesh != null && mesh.IsValid ? mesh : null;
        }
        catch
        {
            return null;
        }
    }

    private static Mesh CreateMeshFromBrep(Brep brep, MeshingParameters mParams)
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

    private static Dictionary<string, string> ParseMetadataString(string s)
    {
        var d = new Dictionary<string, string>();
        if (string.IsNullOrWhiteSpace(s))
        {
            return d;
        }

        foreach (var pair in s.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split(new[] { '=' }, 2);
            if (parts.Length == 2)
            {
                d[parts[0].Trim()] = parts[1].Trim();
            }
        }

        return d;
    }
}
