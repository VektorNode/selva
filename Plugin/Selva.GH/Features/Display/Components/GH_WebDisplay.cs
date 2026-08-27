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

/// <summary>One input branch's worth of display data, tagged with its Grasshopper path.</summary>
public sealed class BranchResult
{
    public BranchResult(GH_Path path)
    {
        Path = path;
    }

    public GH_Path Path { get; }

    public List<float[]> MeshVertices { get; } = new List<float[]>();
    public List<int[]> MeshFaces { get; } = new List<int[]>();

    /// <summary>Per-mesh texture coordinates (u,v per vertex); null entries mean "mesh has none".</summary>
    public List<float[]> MeshUvs { get; } = new List<float[]>();

    /// <summary>Per-mesh vertex colors (r,g,b per vertex); null entries mean "mesh has none".</summary>
    public List<byte[]> MeshColors { get; } = new List<byte[]>();

    public List<string> Names { get; } = new List<string>();
    public List<string> Layers { get; } = new List<string>();
    public List<Dictionary<string, string>> Metadata { get; } = new List<Dictionary<string, string>>();
    public List<ThreeMaterial> Materials { get; } = new List<ThreeMaterial>();

    /// <summary>Non-mesh display items (curves, points) for this branch's batch.</summary>
    public List<DisplayItem> Items { get; } = new List<DisplayItem>();

    /// <summary>Encoded batch (combined arrays, quantized + deflated); null when the branch is empty.</summary>
    public DisplayBatch Batch { get; set; }

    public int Count => MeshVertices.Count + Items.Count;
}

/// <summary>
///     Result of the single background task: one <see cref="BranchResult" /> per input branch, plus
///     viewport preview lists gathered across all branches and the total skipped count.
/// </summary>
public sealed class SolveResult
{
    public SolveResult(List<BranchResult> branches, List<Mesh> previewMeshes,
        List<ThreeMaterial> previewMaterials, List<Curve> previewCurves, List<Color> curveColors,
        List<Point3d> previewPoints, List<Color> pointColors, BoundingBox previewBounds,
        int skipped = 0)
    {
        Branches = branches;
        PreviewMeshes = previewMeshes;
        PreviewMaterials = previewMaterials;
        PreviewCurves = previewCurves;
        CurveColors = curveColors;
        PreviewPoints = previewPoints;
        PointColors = pointColors;
        PreviewBounds = previewBounds;
        Skipped = skipped;
    }

    public List<BranchResult> Branches { get; }

    // Preview spans every branch (one component draws all its geometry), so these are flat lists
    // aligned 1:1 within each kind.
    public List<Mesh> PreviewMeshes { get; }
    public List<ThreeMaterial> PreviewMaterials { get; }
    public List<Curve> PreviewCurves { get; }
    public List<Color> CurveColors { get; }
    public List<Point3d> PreviewPoints { get; }
    public List<Color> PointColors { get; }

    /// <summary>Union of every preview geometry's bounding box, computed off the main thread.</summary>
    public BoundingBox PreviewBounds { get; }

    public int Skipped { get; }

    public int Count => Branches.Sum(b => b.Count);
}

/// <summary>
///     Converts geometry to a WebDisplay output, one batch per input branch. Reads all inputs as
///     trees so SolveInstance runs once, queuing a single background task; the output tree mirrors
///     the input tree.
/// </summary>
public class WebDisplay : GH_TaskCapableComponent<SolveResult>
{
    private BoundingBox _previewBB;
    private List<GH_CustomPreviewItem> _previewItems;
    private List<(Curve curve, Color color)> _previewCurves;
    private List<(Point3d point, Color color)> _previewPoints;

    public WebDisplay()
        : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override Guid ComponentGuid => new Guid("E4111712-6F0A-4F1B-950F-777EECAEBE01");
    public override BoundingBox ClippingBox => _previewBB;
    public override bool IsPreviewCapable => true;

    public override void ClearData()
    {
        base.ClearData();
        _previewItems = null;
        _previewCurves = null;
        _previewPoints = null;
        _previewBB = BoundingBox.Empty;
    }

    protected override void RegisterInputParams(GH_InputParamManager pManager)
    {
        pManager.AddGeometryParameter("Geo", "G", "Geometry to display", GH_ParamAccess.tree);
        pManager.AddTextParameter("Name", "N", "Name of the mesh", GH_ParamAccess.tree, "");
        pManager.AddTextParameter("Layer", "L", "Layer for grouping in scene manager (e.g. 'Structure/Walls')",
            GH_ParamAccess.tree, "");
        pManager.AddTextParameter("Metadata", "D", "Metadata for the mesh (Format: 'Key=Value')", GH_ParamAccess.tree);
        pManager.AddParameter(new Param_ThreeMaterial("Material", "M", "Material for web display", "Selva",
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
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD",
            "Geometry data for web display, one per input branch (output tree mirrors the input tree, "
            + "including empty branches)",
            "Selva", "Display", GH_ParamAccess.tree));
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
                    ComputeBatch(geoTree, nameTree, layerTree, metaTree, matTree, meshSettings, componentId),
                CancelToken));
            return;
        }

        if (!GetSolveResults(DA, out var result))
        {
            result = ComputeBatch(geoTree, nameTree, layerTree, metaTree, matTree, meshSettings, componentId);
        }

        if (result == null)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid geometry could be displayed");
            return;
        }

        // Input had branches but none produced displayable geometry — warn, then still emit the
        // mirrored (all-empty) tree so downstream components keep the paths.
        if (result.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid geometry could be displayed");
        }
        else if (result.Skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{result.Skipped} item(s) could not be displayed and were skipped");
        }

        // Batches are already encoded (merge, quantize, deflate) from the background task; this loop
        // only assembles the tree. Empty input branches still get an EnsurePath'd empty branch rather
        // than vanishing.
        var output = new GH_Structure<WebDisplayGoo>();
        foreach (var b in result.Branches)
        {
            if (b.Batch != null)
            {
                output.Append(new WebDisplayGoo(b.Batch), b.Path);
            }
            else
            {
                output.EnsurePath(b.Path);
            }
        }

        DA.SetDataTree(0, output);

        // Build preview items on the main thread (Rhino display API requirement); clipping box was
        // already unioned in the background pass.
        _previewItems = new List<GH_CustomPreviewItem>(result.PreviewMeshes.Count);
        _previewBB = result.PreviewBounds;
        var matCache = new Dictionary<(int argb, double opacity), DisplayMaterial>();

        for (var i = 0; i < result.PreviewMeshes.Count; i++)
        {
            var mesh = result.PreviewMeshes[i];
            var mat = result.PreviewMaterials[i];

            // MaterialBestGuess goes through Rhino's render-content system and is expensive; cache by
            // color+opacity (what actually distinguishes preview shading) instead of running it per mesh.
            var key = (mat.Color.ToArgb(), mat.Opacity);
            if (!matCache.TryGetValue(key, out var dispMat))
            {
                var renderMat = new GH_Material(mat.Color).MaterialBestGuess();
                var rhinoMat = renderMat.ToMaterial(RenderTexture.TextureGeneration.Disallow);
                dispMat = new DisplayMaterial(rhinoMat)
                {
                    Transparency = 1.0 - mat.Opacity,
                    IsTwoSided = true
                };
                matCache[key] = dispMat;
            }

            _previewItems.Add(new GH_CustomPreviewItem
            {
                Geometry = new GH_Mesh(mesh),
                Shader = dispMat,
                Colour = dispMat.Diffuse
            });
        }

        // The batch's curve/point JSON isn't drawable, so keep the original Rhino geometry (with its
        // item color) and draw it as wires in DrawViewportWires.
        _previewCurves = new List<(Curve, Color)>(result.PreviewCurves.Count);
        for (var i = 0; i < result.PreviewCurves.Count; i++)
        {
            _previewCurves.Add((result.PreviewCurves[i], result.CurveColors[i]));
        }

        _previewPoints = new List<(Point3d, Color)>(result.PreviewPoints.Count);
        for (var i = 0; i < result.PreviewPoints.Count; i++)
        {
            _previewPoints.Add((result.PreviewPoints[i], result.PointColors[i]));
        }
    }

    private static List<T> ResolveBranch<T>(IGH_Structure tree, GH_Path path) where T : class
    {
        if (tree == null || tree.IsEmpty)
        {
            return new List<T>();
        }

        var branch = tree.get_Branch(path)?.Cast<T>().ToList();
        if (branch != null && branch.Count > 0)
        {
            return branch;
        }

        // Single-branch tree: apply it to every geometry path regardless of its actual path. Common
        // case: an aux input (materials/names/…) is a flat list landing on a shallower path than the
        // geometry (e.g. geo on {0;0;0}, materials on {0}) — exact-path or {0}-only matching would
        // miss it and silently fall back to defaults.
        if (tree.PathCount == 1)
        {
            var only = tree.get_Branch(tree.Paths[0])?.Cast<T>().ToList();
            if (only != null && only.Count > 0)
            {
                return only;
            }
        }

        var fallback = tree.get_Branch(new GH_Path(0))?.Cast<T>().ToList();
        return fallback ?? new List<T>();
    }

    /// <summary>One geometry to process, with its resolved per-item attributes and owning branch.</summary>
    private struct WorkItem
    {
        public GeometryBase Geom;
        public int BranchIndex;
        public int Ordinal;
        public string Name;
        public string Layer;
        public Dictionary<string, string> Metadata;
        public ThreeMaterial Material;
    }

    /// <summary>Per-slot output of the parallel pass; gathered back into its branch in tree order.</summary>
    private struct WorkResult
    {
        public bool Skipped;

        // Mesh path. Vertex/face arrays are extracted here, on the parallel thread, so the serial
        // assembly pass (MeshBatchProcessor.CreateBatch) doesn't re-walk every vertex on one thread.
        // Mesh itself is kept for the main-thread viewport preview.
        public Mesh Mesh;
        public string MeshName;
        public float[] MeshVertices;
        public int[] MeshFaces;

        // Optional per-vertex channels (UVs additionally require the material to map a texture).
        // Null = mesh contributes none.
        public float[] MeshUvs;
        public byte[] MeshColors;

        // Item path (curve / point).
        public DisplayItem Item;
        public Curve PreviewCurve;
        public Point3d? PreviewPoint;
        public Color PreviewColor;

        public BoundingBox Bounds;
    }

    private static SolveResult ComputeBatch(
        GH_Structure<IGH_GeometricGoo> geoTree,
        GH_Structure<GH_String> nameTree,
        GH_Structure<GH_String> layerTree,
        GH_Structure<GH_String> metaTree,
        GH_Structure<ThreeMaterialGoo> matTree,
        MeshingParameters meshSettings,
        string componentId)
    {
        // Pass 1 (cheap, sequential): flatten the trees into a work list, resolving each item's
        // attributes, stable ordinal, and owning branch. Geometry extraction touches GH_Goo wrappers
        // and must not race with the parallel pass, so it stays here; invalid geometry is skipped now.
        var work = new List<WorkItem>();
        var branchPaths = new List<GH_Path>();
        var skipped = 0;
        var ordinal = 0;

        foreach (var path in geoTree.Paths)
        {
            // Every input path becomes an output branch, even empty ones — an empty input branch gets
            // a BranchResult but no work items, and falls through to an EnsurePath'd empty branch
            // when the tree is assembled.
            var branchIndex = branchPaths.Count;
            branchPaths.Add(path);

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

            for (var i = 0; i < geoItems.Count; i++, ordinal++)
            {
                var geom = TryExtractGeometry(geoItems[i]);
                if (geom == null || !geom.IsValid)
                {
                    skipped++;
                    continue;
                }

                work.Add(new WorkItem
                {
                    Geom = geom,
                    BranchIndex = branchIndex,
                    Ordinal = ordinal,
                    Name = i < nameItems.Count ? nameItems[i]?.Value ?? lastName : lastName,
                    Layer = i < layerItems.Count ? layerItems[i]?.Value ?? lastLayer : lastLayer,
                    Metadata = ResolveMetadata(metaItems, geoItems.Count, i, lastMeta),
                    Material = i < matItems.Count ? matItems[i]?.Value ?? lastMat : lastMat
                });
            }
        }

        // Pass 2 (expensive, parallel): mesh breps/surfaces and build curve/point items. Each slot
        // writes only its own index, so no locking is needed. Rhino meshing is thread-safe per
        // geometry; meshSettings is read-only here.
        var results = new WorkResult[work.Count];
        Parallel.For(0, work.Count, idx =>
        {
            var w = work[idx];

            // Curves and points aren't meshable — they travel as JSON display items. Curves are
            // tessellated to a polyline here, so the web needs no rhino3dm.
            if (TryBuildItem(w.Geom, componentId, w.Ordinal, w.Name, w.Layer, w.Metadata, w.Material,
                    out var item, out var previewCurve, out var previewPoint))
            {
                var itemBounds = BoundingBox.Empty;
                if (previewCurve != null)
                {
                    itemBounds = previewCurve.GetBoundingBox(false);
                }
                else if (previewPoint.HasValue)
                {
                    itemBounds = new BoundingBox(previewPoint.Value, previewPoint.Value);
                }

                results[idx] = new WorkResult
                {
                    Item = item,
                    PreviewCurve = previewCurve,
                    PreviewPoint = previewPoint,
                    PreviewColor = w.Material.Color,
                    Bounds = itemBounds
                };
                return;
            }

            var mesh = ConvertSingleGeometry(w.Geom, meshSettings);
            if (mesh == null || !mesh.IsValid)
            {
                results[idx] = new WorkResult { Skipped = true };
                return;
            }

            // UVs are only worth carrying when the material actually maps a texture — brep meshing
            // auto-fills TextureCoordinates with surface params, and emitting those for every plain
            // mesh would inflate the payload for nothing. Vertex colors only exist when something
            // explicitly set them, so presence alone is the gate.
            var wantUvs = !string.IsNullOrEmpty(w.Material?.Map)
                          && mesh.TextureCoordinates.Count == mesh.Vertices.Count;
            var wantColors = mesh.VertexColors.Count == mesh.Vertices.Count
                             && mesh.VertexColors.Count > 0;

            // Brep meshing emits one vertex per face-corner, so a clean box arrives with ~3x the
            // vertices it needs. Weld coincident vertices to shrink the payload, but respect normals
            // (ignoreNormals: false): both the web and the C# preview recompute smooth normals via
            // computeVertexNormals, which averages across every shared vertex, so welding across hard
            // edges would smear them. Computing normals first lets the weld keep hard-edge vertices
            // split (different normals) while merging smooth-surface interiors — preserving shading
            // while still cutting most duplication.
            //
            // The weld must also respect any exported channel (ignoreAdditional: false), or vertices
            // with different UVs/colors would merge and smear texture seams / color boundaries.
            // Channels NOT being exported are cleared first so stale auto-generated data (brep TCs,
            // partial color sets) can't block the weld.
            mesh.Normals.ComputeNormals();
            if (wantUvs || wantColors)
            {
                if (!wantUvs && mesh.TextureCoordinates.Count > 0)
                {
                    mesh.TextureCoordinates.Clear();
                }

                if (!wantColors && mesh.VertexColors.Count > 0)
                {
                    mesh.VertexColors.Clear();
                }

                mesh.Vertices.CombineIdentical(false, false);
            }
            else
            {
                mesh.Vertices.CombineIdentical(false, true);
            }

            mesh.Compact();

            // Extract the arrays now, off the main thread — the per-vertex copy CreateBatch would
            // otherwise do serially for every mesh in the batch.
            var (vertices, faces, uvs, colors) = GeoMeshProcessor.ConvertMeshToArrays(mesh, wantUvs, wantColors);

            results[idx] = new WorkResult
            {
                Mesh = mesh,
                MeshName = w.Name,
                MeshVertices = vertices,
                MeshFaces = faces,
                MeshUvs = uvs,
                MeshColors = colors,
                Bounds = mesh.GetBoundingBox(false)
            };
        });

        // Pass 3 (cheap, sequential): gather each slot back into its branch in tree order for
        // deterministic output. Preview lists are global (one component draws everything).
        var branches = new List<BranchResult>(branchPaths.Count);
        foreach (var p in branchPaths)
        {
            branches.Add(new BranchResult(p));
        }

        var previewMeshes = new List<Mesh>();
        var previewMaterials = new List<ThreeMaterial>();
        var previewCurves = new List<Curve>();
        var curveColors = new List<Color>();
        var previewPoints = new List<Point3d>();
        var pointColors = new List<Color>();
        var previewBounds = BoundingBox.Empty;

        for (var idx = 0; idx < results.Length; idx++)
        {
            var r = results[idx];
            if (r.Skipped)
            {
                skipped++;
                continue;
            }

            previewBounds.Union(r.Bounds);

            var w = work[idx];
            var branch = branches[w.BranchIndex];

            if (r.Item != null)
            {
                branch.Items.Add(r.Item);
                if (r.PreviewCurve != null)
                {
                    previewCurves.Add(r.PreviewCurve);
                    curveColors.Add(r.PreviewColor);
                }

                if (r.PreviewPoint.HasValue)
                {
                    previewPoints.Add(r.PreviewPoint.Value);
                    pointColors.Add(r.PreviewColor);
                }

                continue;
            }

            branch.MeshVertices.Add(r.MeshVertices);
            branch.MeshFaces.Add(r.MeshFaces);
            branch.MeshUvs.Add(r.MeshUvs);
            branch.MeshColors.Add(r.MeshColors);
            branch.Names.Add(!string.IsNullOrWhiteSpace(r.MeshName)
                ? r.MeshName
                : branch.MeshVertices.Count.ToString());
            branch.Layers.Add(w.Layer ?? "");
            branch.Metadata.Add(w.Metadata);
            branch.Materials.Add(w.Material);

            previewMeshes.Add(r.Mesh);
            previewMaterials.Add(w.Material);
        }

        // No input paths at all → nothing to mirror. When there ARE paths but none carry geometry,
        // still return a result so the output mirrors the input's empty-branch structure.
        if (branches.Count == 0)
        {
            return null;
        }

        // Pass 4 (expensive, parallel across branches): encode each branch's batch — combined-array
        // merge, quantization, deflate — still inside the background task, so the solver thread never
        // pays for the encode.
        Parallel.ForEach(branches, b =>
        {
            if (b.Count == 0)
            {
                return;
            }

            var batch = MeshBatchProcessor.CreateBatch(
                b.MeshVertices, b.MeshFaces, b.Names, b.Materials, b.Metadata, b.Layers, componentId,
                b.MeshUvs, b.MeshColors);
            if (b.Items.Count > 0)
            {
                batch.Items = b.Items;
            }

            b.Batch = batch;
        });

        return new SolveResult(branches, previewMeshes, previewMaterials, previewCurves, curveColors,
            previewPoints, pointColors, previewBounds, skipped);
    }

    /// <summary>
    ///     Metadata dictionary for the <paramref name="i" />-th geometry in a branch. When a branch has
    ///     more metadata strings than geometry, all extras merge into the one item.
    /// </summary>
    private static Dictionary<string, string> ResolveMetadata(
        List<GH_String> metaItems, int geoCount, int i, string lastMeta)
    {
        if (metaItems.Count > geoCount)
        {
            var merged = new Dictionary<string, string>();
            foreach (var m in metaItems)
            {
                if (m?.Value == null)
                {
                    continue;
                }

                foreach (var kv in ParseMetadataString(m.Value))
                {
                    merged[kv.Key] = kv.Value;
                }
            }

            return merged;
        }

        var metaStr = i < metaItems.Count ? metaItems[i]?.Value ?? lastMeta : lastMeta;
        return ParseMetadataString(metaStr);
    }

    /// <summary>
    ///     Builds a <see cref="DisplayItem" /> if the geometry is a curve or point, surfacing the
    ///     original Rhino geometry for viewport preview. Returns false for meshable geometry.
    /// </summary>
    private static bool TryBuildItem(
        GeometryBase geom, string componentId, int ordinal,
        string name, string layer, Dictionary<string, string> metadata, ThreeMaterial mat,
        out DisplayItem item, out Curve previewCurve, out Point3d? previewPoint)
    {
        item = null;
        previewCurve = null;
        previewPoint = null;

        var id = $"{componentId}:{ordinal}";
        var displayName = !string.IsNullOrWhiteSpace(name) ? name : ordinal.ToString();
        var colorHex = ColorTranslator.ToHtml(mat.Color);
        double? opacity = mat.Opacity < 1.0 ? mat.Opacity : (double?)null;

        switch (geom)
        {
            case Curve curve:
            {
                var nurbs = curve.ToNurbsCurve();
                if (nurbs == null)
                {
                    return false;
                }

                var json = nurbs.ToJSON(new Rhino.FileIO.SerializationOptions());
                var points = CurveTessellator.Tessellate(curve);
                item = DisplayItem.Curve(json, points, id, displayName, layer ?? "", metadata,
                    colorHex, opacity);
                previewCurve = curve;
                return true;
            }
            case Rhino.Geometry.Point pointGeom:
            {
                item = DisplayItem.Point(pointGeom.Location, id, displayName, layer ?? "", metadata,
                    colorHex, opacity);
                previewPoint = pointGeom.Location;
                return true;
            }
            default:
                return false;
        }
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
        if (Locked)
        {
            return;
        }

        if (_previewItems != null)
        {
            foreach (var item in _previewItems)
            {
                item.Geometry.DrawViewportWires(new GH_PreviewWireArgs(
                    args.Viewport, args.Display,
                    Attributes.Selected ? args.WireColour_Selected : args.WireColour,
                    args.DefaultCurveThickness));
            }
        }

        if (_previewCurves != null)
        {
            foreach (var (curve, color) in _previewCurves)
            {
                args.Display.DrawCurve(curve,
                    Attributes.Selected ? args.WireColour_Selected : color,
                    args.DefaultCurveThickness);
            }
        }

        if (_previewPoints != null)
        {
            foreach (var (point, color) in _previewPoints)
            {
                args.Display.DrawPoint(point, PointStyle.RoundSimple, 4,
                    Attributes.Selected ? args.WireColour_Selected : color);
            }
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

        // GH_Line/Arc/Circle/Point etc. expose their value as a struct, not a GeometryBase, so
        // `ScriptVariable() is GeometryBase` above misses them. Convert each to its GeometryBase form
        // here so the item path can route it to a curve/point display item.
        return goo switch
        {
            GH_GeometricGoo<GeometryBase> x => x.Value,
            GH_Mesh x => x.Value,
            GH_Brep x => x.Value,
            GH_Surface x => x.Value,
            GH_Curve x => x.Value,
            GH_Line x when x.Value.IsValid => new LineCurve(x.Value),
            GH_Arc x when x.Value.IsValid => new ArcCurve(x.Value),
            GH_Circle x when x.Value.IsValid => new ArcCurve(x.Value),
            GH_Rectangle x when x.Value.IsValid => x.Value.ToNurbsCurve(),
            GH_Point x => new Rhino.Geometry.Point(x.Value),
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
