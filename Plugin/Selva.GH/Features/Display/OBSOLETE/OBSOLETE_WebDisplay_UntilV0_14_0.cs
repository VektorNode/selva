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

namespace Selva.GH.Features.Display.OBSOLETE;

// Result of the single background task: all items batched together.
public sealed class SolveResult_V0_14_0
{
    public SolveResult_V0_14_0(List<Mesh> meshes, List<string> names, List<string> layers,
        List<Dictionary<string, string>> metadata, List<ThreeMaterial> materials,
        List<DisplayItem> items, List<Curve> previewCurves, List<Point3d> previewPoints,
        int skipped = 0)
    {
        Meshes = meshes;
        Names = names;
        Layers = layers;
        Metadata = metadata;
        Materials = materials;
        Items = items;
        PreviewCurves = previewCurves;
        PreviewPoints = previewPoints;
        Skipped = skipped;
    }

    public List<Mesh> Meshes { get; }
    public List<string> Names { get; }
    public List<string> Layers { get; }
    public List<Dictionary<string, string>> Metadata { get; }
    public List<ThreeMaterial> Materials { get; }

    /// <summary>Non-mesh display items (curves, points) ready to attach to the batch.</summary>
    public List<DisplayItem> Items { get; }

    /// <summary>Original Rhino curves kept for viewport preview (the JSON in Items isn't drawable).</summary>
    public List<Curve> PreviewCurves { get; }

    /// <summary>Original Rhino points kept for viewport preview.</summary>
    public List<Point3d> PreviewPoints { get; }

    public int Skipped { get; }

    public int Count => Meshes.Count + Items.Count;
}

/// <summary>
///     Obsolete WebDisplay component (until v0.14.0). Replaced by the version that maps each
///     Grasshopper branch to its own scene-manager group when no explicit Layer is provided.
///     This version flattened every branch into a single group ("Default" when no layer set).
/// </summary>
public class OBSOLETE_WebDisplay_UntilV0_14_0 : GH_TaskCapableComponent<SolveResult_V0_14_0>
{
    private BoundingBox _previewBB;
    private List<GH_CustomPreviewItem> _previewItems;
    private List<(Curve curve, Color color)> _previewCurves;
    private List<(Point3d point, Color color)> _previewPoints;

    public OBSOLETE_WebDisplay_UntilV0_14_0()
        : base("Display", "D", "Converts geometry to display file", "Selva", "Display")
    {
    }

    protected override Bitmap Icon => Resources.WebDisplay;
    public override Guid ComponentGuid => new Guid("4F7A9C2E-1B3D-4E8F-A6C0-9D2E5B7F1A4C");
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
        pManager.AddParameter(new Param_WebDisplay("Web Display", "WD", "Geometry data for web display", "Selva",
            "Display", GH_ParamAccess.item));
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

        if (result == null || result.Count == 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No valid geometry could be displayed");
            return;
        }

        if (result.Skipped > 0)
        {
            AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
                $"{result.Skipped} item(s) could not be displayed and were skipped");
        }

        // Meshes go through the binary blob path; curves/points ride as JSON items. CreateBatch
        // always emits a valid (possibly empty) blob, so an items-only batch is well-formed.
        var batch = MeshBatchProcessor.CreateBatch(
            result.Meshes, result.Names, result.Materials, result.Metadata,
            result.Layers, componentId);
        if (result.Items.Count > 0)
        {
            batch.Items = result.Items;
        }

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

        // Curve / point preview: the JSON in the batch isn't drawable, so we keep the original Rhino
        // geometry (with its item color) and draw it as wires in DrawViewportWires.
        _previewCurves = new List<(Curve, Color)>(result.PreviewCurves.Count);
        for (var i = 0; i < result.PreviewCurves.Count; i++)
        {
            var curve = result.PreviewCurves[i];
            _previewCurves.Add((curve, ColorOf(result.Items, "curve", i)));
            _previewBB.Union(curve.GetBoundingBox(false));
        }

        _previewPoints = new List<(Point3d, Color)>(result.PreviewPoints.Count);
        for (var i = 0; i < result.PreviewPoints.Count; i++)
        {
            var point = result.PreviewPoints[i];
            _previewPoints.Add((point, ColorOf(result.Items, "point", i)));
            _previewBB.Union(new BoundingBox(point, point));
        }
    }

    /// <summary>
    ///     Pulls the preview color for the <paramref name="ordinal" />-th item of a given kind from the
    ///     built items list (which carries the resolved color hex). Falls back to white.
    /// </summary>
    private static Color ColorOf(List<DisplayItem> items, string kind, int ordinal)
    {
        var seen = 0;
        foreach (var it in items)
        {
            if (it.Kind != kind)
            {
                continue;
            }

            if (seen == ordinal)
            {
                return it.Color != null ? ColorTranslator.FromHtml(it.Color) : Color.White;
            }

            seen++;
        }

        return Color.White;
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
    ///     One geometry to process, with its already-resolved per-item attributes and stable ordinal.
    ///     The cheap flatten pass produces these in tree order; the expensive meshing then runs over
    ///     them in parallel.
    /// </summary>
    private struct WorkItem
    {
        public GeometryBase Geom;
        public int Ordinal;
        public string Name;
        public string Layer;
        public Dictionary<string, string> Metadata;
        public ThreeMaterial Material;
    }

    /// <summary>Per-slot output of the parallel pass; gathered back in tree order.</summary>
    private struct WorkResult
    {
        public bool Skipped;

        // Mesh path
        public Mesh Mesh;
        public string MeshName;

        // Item path (curve / point)
        public DisplayItem Item;
        public Curve PreviewCurve;
        public Point3d? PreviewPoint;
    }

    private static SolveResult_V0_14_0 ComputeBatch(
        GH_Structure<IGH_GeometricGoo> geoTree,
        GH_Structure<GH_String> nameTree,
        GH_Structure<GH_String> layerTree,
        GH_Structure<GH_String> metaTree,
        GH_Structure<ThreeMaterialGoo> matTree,
        MeshingParameters meshSettings,
        string componentId)
    {
        // Pass 1 (cheap, sequential): flatten the trees into a work list, resolving each item's
        // attributes and stable ordinal. Geometry extraction touches GH_Goo wrappers and must not
        // race with the parallel pass, so it stays here. Invalid geometry counts as skipped now.
        var work = new List<WorkItem>();
        var skipped = 0;
        var ordinal = 0;

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
                results[idx] = new WorkResult
                {
                    Item = item,
                    PreviewCurve = previewCurve,
                    PreviewPoint = previewPoint
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

            results[idx] = new WorkResult
            {
                Mesh = mesh,
                MeshName = w.Name
            };
        });

        // Pass 3 (cheap, sequential): gather in tree order so output ordering is deterministic and
        // matches the pre-parallel behaviour.
        var meshes = new List<Mesh>();
        var names = new List<string>();
        var layers = new List<string>();
        var metadata = new List<Dictionary<string, string>>();
        var materials = new List<ThreeMaterial>();
        var items = new List<DisplayItem>();
        var previewCurves = new List<Curve>();
        var previewPoints = new List<Point3d>();

        for (var idx = 0; idx < results.Length; idx++)
        {
            var r = results[idx];
            if (r.Skipped)
            {
                skipped++;
                continue;
            }

            if (r.Item != null)
            {
                items.Add(r.Item);
                if (r.PreviewCurve != null)
                {
                    previewCurves.Add(r.PreviewCurve);
                }

                if (r.PreviewPoint.HasValue)
                {
                    previewPoints.Add(r.PreviewPoint.Value);
                }

                continue;
            }

            var w = work[idx];
            meshes.Add(r.Mesh);
            names.Add(!string.IsNullOrWhiteSpace(r.MeshName) ? r.MeshName : meshes.Count.ToString());
            layers.Add(w.Layer ?? "");
            metadata.Add(w.Metadata);
            materials.Add(w.Material);
        }

        var hasAnything = meshes.Count > 0 || items.Count > 0;
        return hasAnything
            ? new SolveResult_V0_14_0(meshes, names, layers, metadata, materials, items, previewCurves,
                previewPoints, skipped)
            : null;
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
                item = DisplayItem.Curve(json, id, displayName, layer ?? "", metadata, colorHex, opacity);
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
