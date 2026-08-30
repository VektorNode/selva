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
using Selva.Slva;

namespace Selva.GH.Features.Display.OBSOLETE;

/// <summary>
///     One input branch's worth of display data for the frozen v0.15.0 component — see
///     <see cref="OBSOLETE_WebDisplay_UntilV0_15_0" />.
/// </summary>
public sealed class BranchResult_V0_15_0
{
    public BranchResult_V0_15_0(GH_Path path)
    {
        Path = path;
    }

    public GH_Path Path { get; }

    public List<float[]> MeshVertices { get; } = new List<float[]>();
    public List<int[]> MeshFaces { get; } = new List<int[]>();
    public List<string> Names { get; } = new List<string>();
    public List<string> Layers { get; } = new List<string>();
    public List<Dictionary<string, string>> Metadata { get; } = new List<Dictionary<string, string>>();
    public List<ThreeMaterial> Materials { get; } = new List<ThreeMaterial>();

    /// <summary>Non-mesh display items (curves, points) for this branch's batch.</summary>
    public List<DisplayItem> Items { get; } = new List<DisplayItem>();

    /// <summary>
    ///     The encoded batch (combined arrays, quantized + deflated blob). Built at the end of the
    ///     background task so the expensive encode never runs on the solver thread; null when the
    ///     branch is empty.
    /// </summary>
    public DisplayBatch Batch { get; set; }

    public int Count => MeshVertices.Count + Items.Count;
}

// Result of the single background task: one BranchResult per input branch, plus the global viewport
// preview lists (drawn across all branches) and the total skipped count.
public sealed class SolveResult_V0_15_0
{
    public SolveResult_V0_15_0(List<BranchResult_V0_15_0> branches, List<Mesh> previewMeshes,
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

    /// <summary>One batch's worth of data per input branch, in tree order.</summary>
    public List<BranchResult_V0_15_0> Branches { get; }

    // Viewport preview spans every branch (it's one component drawing all its geometry), so these are
    // flat lists gathered across branches, aligned 1:1 within each kind.
    public List<Mesh> PreviewMeshes { get; }
    public List<ThreeMaterial> PreviewMaterials { get; }
    public List<Curve> PreviewCurves { get; }
    public List<Color> CurveColors { get; }
    public List<Point3d> PreviewPoints { get; }
    public List<Color> PointColors { get; }

    /// <summary>
    ///     Union of every preview geometry's bounding box, computed in the background pass so the
    ///     main thread doesn't re-walk all preview geometry to build the clipping box.
    /// </summary>
    public BoundingBox PreviewBounds { get; }

    public int Skipped { get; }

    public int Count => Branches.Sum(b => b.Count);
}

/// <summary>
///     Obsolete WebDisplay component (until v0.15.0). Replaced by the version that carries
///     optional texture coordinates and vertex colors into the web display batch (and welds
///     accordingly). This version ships position + topology only.
/// </summary>
public class OBSOLETE_WebDisplay_UntilV0_15_0 : GH_TaskCapableComponent<SolveResult_V0_15_0>
{
    private BoundingBox _previewBB;
    private List<GH_CustomPreviewItem> _previewItems;
    private List<(Curve curve, Color color)> _previewCurves;
    private List<(Point3d point, Color color)> _previewPoints;

    public OBSOLETE_WebDisplay_UntilV0_15_0()
        : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override Guid ComponentGuid => new Guid("CEC76466-37FD-4B1B-8C7F-71E5C1FDBA14");
    public override GH_Exposure Exposure => GH_Exposure.hidden;
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

        // No displayable geometry, but the input still had branches — warn, then fall through to
        // emit the mirrored (all-empty) tree structure so downstream components keep the paths.
        if (result.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid geometry could be displayed");
        }
        else if (result.Skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{result.Skipped} item(s) could not be displayed and were skipped");
        }

        // Emit each branch's batch onto its matching output path, so the output tree mirrors the
        // input tree — including empty input branches, which produce an empty branch at the same
        // path (EnsurePath) rather than vanishing. The batches were already encoded (merge,
        // quantize, deflate) inside the background task; this loop only assembles the tree.
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

        // Build preview items on main thread (Rhino display API requirement). Preview spans every
        // branch — it's one component drawing all of its geometry, regardless of tree structure.
        // The clipping box was already unioned in the background pass.
        _previewItems = new List<GH_CustomPreviewItem>(result.PreviewMeshes.Count);
        _previewBB = result.PreviewBounds;
        var matCache = new Dictionary<(int argb, double opacity), DisplayMaterial>();

        for (var i = 0; i < result.PreviewMeshes.Count; i++)
        {
            var mesh = result.PreviewMeshes[i];
            var mat = result.PreviewMaterials[i];

            // MaterialBestGuess goes through Rhino's render-content system and is expensive; cache
            // by what actually distinguishes preview shading (color + opacity) so the whole dance
            // runs once per distinct material instead of once per mesh.
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

        // Curve / point preview: the JSON in the batch isn't drawable, so we keep the original Rhino
        // geometry (with its item color) and draw it as wires in DrawViewportWires.
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

        // Exact path match first.
        var branch = tree.get_Branch(path)?.Cast<T>().ToList();
        if (branch != null && branch.Count > 0)
        {
            return branch;
        }

        // Single-branch tree: apply it to every geometry path regardless of its actual path. This is
        // the common case where an aux input (materials/names/…) is a flat list but lands on a deeper
        // path than the geometry (e.g. geo on {0}, materials on {0;0;0}) — matching by exact path or
        // {0} alone would miss it and silently fall back to defaults.
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

    /// <summary>
    ///     One geometry to process, with its already-resolved per-item attributes, stable ordinal, and
    ///     the index of the branch it belongs to. The cheap flatten pass produces these in tree order;
    ///     the expensive meshing then runs over them in parallel.
    /// </summary>
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

        // Mesh path. The vertex/face arrays are extracted here, on the parallel thread, so the serial
        // assembly pass (MeshBatchProcessor.CreateBatch) doesn't re-walk every vertex on one thread.
        // Mesh itself is kept for the main-thread viewport preview.
        public Mesh Mesh;
        public string MeshName;
        public float[] MeshVertices;
        public int[] MeshFaces;

        // Item path (curve / point). PreviewColor is resolved here so the gather pass doesn't re-scan
        // the items list to recover each curve/point's color.
        public DisplayItem Item;
        public Curve PreviewCurve;
        public Point3d? PreviewPoint;
        public Color PreviewColor;

        // Preview bounding box for this slot (mesh, curve or point), computed on the parallel
        // thread so the main thread doesn't re-walk every preview geometry for the clipping box.
        public BoundingBox Bounds;
    }

    private static SolveResult_V0_15_0 ComputeBatch(
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
        // and must not race with the parallel pass, so it stays here. Invalid geometry counts as
        // skipped now. Each non-empty geometry branch is recorded as its own output branch — the
        // output tree mirrors the input tree.
        var work = new List<WorkItem>();
        var branchPaths = new List<GH_Path>();
        var skipped = 0;
        var ordinal = 0;

        foreach (var path in geoTree.Paths)
        {
            // Record every input path as an output branch, even empty ones, so the output tree
            // mirrors the input tree exactly (an empty input branch → an empty output branch at the
            // same path). Empty branches get a BranchResult but no work items, so they fall through
            // to an EnsurePath'd empty branch when the tree is assembled.
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

        // Pass 2 (expensive, parallel): mesh breps/surfaces and build curve/point items. Each slot is
        // independent and writes only its own index, so no locking is needed. Rhino meshing is
        // thread-safe per geometry; meshSettings is read-only here.
        var results = new WorkResult[work.Count];
        Parallel.For(0, work.Count, idx =>
        {
            var w = work[idx];

            // Curves and points are not meshable — they travel as JSON display items, decoded
            // and tessellated on the web (curves via rhino3dm, points as raw vertices).
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

            // Brep meshing emits one vertex per face-corner, so a clean box arrives with ~3x the
            // vertices it needs. We weld coincident vertices to shrink the payload, but RESPECTING
            // normals (ignoreNormals: false): both the web and the C# preview recompute smooth normals
            // via computeVertexNormals, which averages across every shared vertex. Welding across hard
            // edges would therefore smear them. Computing normals first lets the weld keep hard-edge
            // vertices split (different normals) while merging smooth-surface interiors (matching
            // normals) — preserving the original shading while still cutting most of the duplication.
            mesh.Normals.ComputeNormals();
            mesh.Vertices.CombineIdentical(false, true);
            mesh.Compact();

            // Extract the vertex/face arrays now, while we're already off the main thread. This is the
            // per-vertex copy that CreateBatch would otherwise do serially for every mesh in the batch.
            var (vertices, faces) = GeoMeshProcessor.ConvertMeshToArrays(mesh);

            results[idx] = new WorkResult
            {
                Mesh = mesh,
                MeshName = w.Name,
                MeshVertices = vertices,
                MeshFaces = faces,
                Bounds = mesh.GetBoundingBox(false)
            };
        });

        // Pass 3 (cheap, sequential): gather each slot back into its branch in tree order, so each
        // branch's output is deterministic. Preview lists are global (one component draws everything).
        var branches = new List<BranchResult_V0_15_0>(branchPaths.Count);
        foreach (var p in branchPaths)
        {
            branches.Add(new BranchResult_V0_15_0(p));
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
            branch.Names.Add(!string.IsNullOrWhiteSpace(r.MeshName)
                ? r.MeshName
                : branch.MeshVertices.Count.ToString());
            branch.Layers.Add(w.Layer ?? "");
            branch.Metadata.Add(w.Metadata);
            branch.Materials.Add(w.Material);

            previewMeshes.Add(r.Mesh);
            previewMaterials.Add(w.Material);
        }

        // No input paths at all → nothing to mirror. (When there ARE paths but none carry geometry,
        // we still return a result so the output tree mirrors the input's empty-branch structure.)
        if (branches.Count == 0)
        {
            return null;
        }

        // Pass 4 (expensive, parallel across branches): encode each branch's batch — combined-array
        // merge, quantization, deflate. This runs here, still inside the background task, so the
        // solver thread never pays for the encode; it only assembles the output tree from the
        // ready-made batches.
        Parallel.ForEach(branches, b =>
        {
            if (b.Count == 0)
            {
                return;
            }

            var inputs = new List<SlvaMeshInput>(b.MeshVertices.Count);
            for (var i = 0; i < b.MeshVertices.Count; i++)
            {
                inputs.Add(new SlvaMeshInput
                {
                    Id = $"{componentId}/{b.Path}/{i}",
                    Vertices = b.MeshVertices[i],
                    Faces = b.MeshFaces[i],
                    Name = b.Names[i],
                    Layer = b.Layers[i],
                    Material = b.Materials[i],
                    Metadata = b.Metadata[i]
                });
            }

            var batch = MeshBatchAssembler.CreateBatch(inputs);
            if (b.Items.Count > 0)
            {
                batch.Items = b.Items;
            }

            b.Batch = batch;
        });

        return new SolveResult_V0_15_0(branches, previewMeshes, previewMaterials, previewCurves, curveColors,
            previewPoints, pointColors, previewBounds, skipped);
    }

    /// <summary>
    ///     Resolves the metadata dictionary for the <paramref name="i" />-th geometry in a branch.
    ///     When a branch has more metadata strings than geometry, all extras merge into the item
    ///     (one geometry, many metadata strings).
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
    ///     If the geometry is a curve or a point, builds the corresponding <see cref="DisplayItem" />
    ///     and surfaces the original Rhino geometry for viewport preview. Returns false for meshable
    ///     geometry (which the caller routes through the mesh path instead).
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
                // Tessellates like the live component: what's frozen here is the param list and GUID,
                // not the payload. A snapshot emitting untessellated curves would fail in the viewer.
                var points = CurveTessellator.Tessellate(curve);
                item = DisplayItem.Curve(json, points, id, displayName, layer ?? "", metadata,
                    colorHex, opacity);
                previewCurve = curve;
                return true;
            }
            case Rhino.Geometry.Point pointGeom:
            {
                item = RhinoDisplayItems.Point(pointGeom.Location, id, displayName, layer ?? "", metadata,
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

        // Several GH curve/point primitives expose their value as a *struct* (Line, Arc, Circle,
        // Point3d, …), which is NOT a GeometryBase — so `ScriptVariable() is GeometryBase` above
        // misses them and they would fall through to null and be skipped. Convert each to its
        // GeometryBase form here so the item path can route it to a curve/point display item.
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
            // GH_Point's ScriptVariable is a Point3d struct (not GeometryBase), so wrap it as a
            // Point GeometryBase here — the item path then routes it to a DisplayPoint.
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
