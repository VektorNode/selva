using System;
using System.Collections.Generic;
using System.Drawing;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Components;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Parameters;
using Grasshopper.Kernel.Types;
using Rhino.Display;
using Rhino.Geometry;
using Rhino.Render;
using Selva.GH.Features.Display.Services;
using Selva.GH.Properties;
using Selva.GH.Utilities;

namespace Selva.GH.Features.Display.Components;

// Per-item result passed back from the background task.
public sealed class SolveResult
{
	public SolveResult(Mesh mesh, string name, Dictionary<string, string> metadata, ThreeMaterial material)
	{
		Mesh = mesh;
		Name = name;
		Metadata = metadata;
		Material = material;
	}

	public Mesh Mesh { get; }
	public string Name { get; }
	public Dictionary<string, string> Metadata { get; }
	public ThreeMaterial Material { get; }
}

/// <summary>
///   Component that converts geometry to displayable format for web viewing.
///   Uses GH_TaskCapableComponent for background meshing while following the
///   BeforeSolveInstance / SolveInstance / AfterSolveInstance pattern of
///   GH_CustomPreviewComponent so GH handles tree iteration and material matching.
/// </summary>
public class WebDisplay : GH_TaskCapableComponent<SolveResult>
{
	private List<GH_CustomPreviewItem> _previewItems;
	private BoundingBox _previewBB;
	private List<Mesh> _meshes;
	private List<string> _names;
	private List<Dictionary<string, string>> _metadata;
	private List<ThreeMaterial> _materials;
	private Dictionary<uint, (RenderMaterial RenderMat, DisplayMaterial DisplayMat)> _matCache;
	private MeshingParameters _meshSettings;

	public WebDisplay()
		: base("Display", "D", "Converts geometry to display file", "Selva", "Display")
	{
	}

	protected override Bitmap Icon => Resources.WebDisplay;
	public override Guid ComponentGuid => new("9B5515B2-861A-4840-B884-82B725203ABB");
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
		// Item access — GH iterates trees and calls SolveInstance once per item,
		// applying longest-list matching automatically across all inputs.
		pManager.AddGeometryParameter("Geo", "G", "Geometry to display", GH_ParamAccess.item);
		pManager.AddTextParameter("Mesh Name", "N", "Name of the mesh", GH_ParamAccess.item, "");
		pManager.AddTextParameter("Metadata", "D", "Metadata for the mesh (Format: 'Key=Value')", GH_ParamAccess.item);
		pManager.AddParameter(new Param_ThreeMaterial("T-Material", "TM", "ThreeMaterial for display", "Selva", "Display", GH_ParamAccess.item));
		pManager.AddParameter(new Param_MeshParameters(), "Meshing Settings", "MS",
			"Meshing settings to use. Default is FastRenderMesh.", GH_ParamAccess.item);

		pManager[2].Optional = true;
		pManager[3].Optional = true;
		pManager[4].Optional = true;
	}

	public override void CreateAttributes()
	{
		m_attributes = new GH_ContextBakeOutputAttributes(this);
	}

	protected override void RegisterOutputParams(GH_OutputParamManager pManager)
	{
		pManager.AddGenericParameter("Web Display", "WD", "Geometry data for web display", GH_ParamAccess.item);
	}



	protected override void BeforeSolveInstance()
	{
		_previewItems = new List<GH_CustomPreviewItem>();
		_previewBB = BoundingBox.Empty;
		_meshes = new List<Mesh>();
		_names = new List<string>();
		_metadata = new List<Dictionary<string, string>>();
		_materials = new List<ThreeMaterial>();
		_matCache = new Dictionary<uint, (RenderMaterial, DisplayMaterial)>();
		_meshSettings = MeshingParameters.FastRenderMesh;
	}

	protected override void SolveInstance(IGH_DataAccess DA)
	{
		// Read inputs (safe on any thread for value types / immutable strings).
		GH_MeshingParameters ghMeshParams = null;
		DA.GetData(4, ref ghMeshParams);
		if (ghMeshParams?.Value != null)
			_meshSettings = ghMeshParams.Value;

		IGH_GeometricGoo geoGoo = null;
		if (!DA.GetData(0, ref geoGoo) || geoGoo == null) return;

		var nameStr = "";
		DA.GetData(1, ref nameStr);

		var metaStr = "";
		DA.GetData(2, ref metaStr);

		ThreeMaterialGoo matGoo = null;
		DA.GetData(3, ref matGoo);
		var mat = matGoo?.Value ?? ThreeMaterial.Default();

		// Capture loop variables for the closure.
		var capturedSettings = _meshSettings;
		var capturedName = nameStr;
		var capturedMeta = metaStr;
		var capturedMat = mat;

		if (InPreSolve)
		{
			// Queue the heavy meshing work on a background thread.
			TaskList.Add(System.Threading.Tasks.Task.Run(() =>
			{
				var geom = TryExtractGeometry(geoGoo);
				if (geom == null || !geom.IsValid) return null;

				var mesh = ConvertSingleGeometry(geom, capturedSettings);
				if (mesh == null || !mesh.IsValid) return null;
				mesh.Normals.ComputeNormals();
				mesh.Compact();

				return new SolveResult(mesh, capturedName, ParseMetadataString(capturedMeta), capturedMat);
			}, CancelToken));
			return;
		}

		// Result-collection pass: GetSolveResults retrieves the completed task result.
		if (!GetSolveResults(DA, out var result) || result == null)
		{
			// Fallback: solve synchronously if no cached result.
			var geom = TryExtractGeometry(geoGoo);
			if (geom == null || !geom.IsValid) return;
			var mesh = ConvertSingleGeometry(geom, capturedSettings);
			if (mesh == null || !mesh.IsValid) return;
			mesh.Normals.ComputeNormals();
			mesh.Compact();
			result = new SolveResult(mesh, capturedName, ParseMetadataString(capturedMeta), capturedMat);
		}

		// Build DisplayMaterial on the main thread (Rhino display API requirement).
		// Exact same pipeline as GH_CustomPreviewComponent:
		// GH_Material → MaterialBestGuess() → cache by RenderHash → ToMaterial() → DisplayMaterial
		var ghMat = new GH_Material(result.Material.Color);
		var renderMat = ghMat.MaterialBestGuess();
		var renderHash = renderMat.RenderHash;

		if (!_matCache.TryGetValue(renderHash, out var cached))
		{
			var rhinoMat = renderMat.ToMaterial(RenderTexture.TextureGeneration.Disallow);
			cached = (renderMat, new DisplayMaterial(rhinoMat)
			{
				Transparency = 1.0 - result.Material.Opacity,
				IsTwoSided = true,
			});
			_matCache[renderHash] = cached;
		}

		_previewItems.Add(new GH_CustomPreviewItem
		{
			Geometry = new GH_Mesh(result.Mesh),
			Shader = cached.DisplayMat,
			Colour = cached.DisplayMat.Diffuse,
		});
		_previewBB.Union(result.Mesh.GetBoundingBox(false));

		var itemIndex = _meshes.Count;
		_meshes.Add(result.Mesh);
		_names.Add(!string.IsNullOrWhiteSpace(result.Name) ? result.Name : itemIndex.ToString());
		_metadata.Add(result.Metadata);
		_materials.Add(result.Material);
	}

	protected override void AfterSolveInstance()
	{
		if (_meshes != null && _meshes.Count > 0)
		{
			try
			{
				var batch = MeshBatchProcessor.CreateBatch(_meshes, _names, _materials, _metadata);
				var tree = new GH_Structure<WebDisplayGoo>();
				tree.Append(new WebDisplayGoo(batch), new GH_Path(0));
				Params.Output[0].AddVolatileDataTree(tree);
			}
			catch (Exception ex)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Failed to build batch: {ex.Message}");
			}
		}

		base.AfterSolveInstance();
	}

	// ── Viewport drawing ─────────────────────────────────────────────────────────

	public override void DrawViewportMeshes(IGH_PreviewArgs args)
	{
		if (Locked || _previewItems == null) return;

		if (Attributes.Selected)
		{
			var sel = new GH_PreviewMeshArgs(args.Viewport, args.Display,
				args.ShadeMaterial_Selected, args.MeshingParameters);
			foreach (var item in _previewItems)
				item.Geometry.DrawViewportMeshes(sel);
		}
		else
		{
			foreach (var item in _previewItems)
				item.Geometry.DrawViewportMeshes(new GH_PreviewMeshArgs(
					args.Viewport, args.Display, item.Shader, args.MeshingParameters));
		}
	}

	public override void DrawViewportWires(IGH_PreviewArgs args)
	{
		if (Locked || _previewItems == null) return;
		foreach (var item in _previewItems)
			item.Geometry.DrawViewportWires(new GH_PreviewWireArgs(
				args.Viewport, args.Display,
				Attributes.Selected ? args.WireColour_Selected : args.WireColour,
				args.DefaultCurveThickness));
	}

	// ── Geometry helpers ─────────────────────────────────────────────────────────

	private static GeometryBase TryExtractGeometry(IGH_Goo goo)
	{
		if (goo == null) return null;
		if (goo.ScriptVariable() is GeometryBase g) return g;
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
		if (geom == null || !geom.IsValid) return null;
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
		catch { return null; }
	}

	private static Mesh CreateMeshFromBrep(Brep brep, MeshingParameters mParams)
	{
		if (brep == null || !brep.IsValid) return null;
		try
		{
			var meshArray = Mesh.CreateFromBrep(brep, mParams);
			if (meshArray == null || meshArray.Length == 0) return null;
			var mesh = new Mesh();
			foreach (var m in meshArray)
				if (m != null && m.IsValid) mesh.Append(m);
			return mesh.Faces.Count > 0 ? mesh : null;
		}
		catch { return null; }
	}

	private static Dictionary<string, string> ParseMetadataString(string s)
	{
		var d = new Dictionary<string, string>();
		if (string.IsNullOrWhiteSpace(s)) return d;
		foreach (var pair in s.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries))
		{
			var parts = pair.Split(new[] { '=' }, 2);
			if (parts.Length == 2) d[parts[0].Trim()] = parts[1].Trim();
		}
		return d;
	}
}
