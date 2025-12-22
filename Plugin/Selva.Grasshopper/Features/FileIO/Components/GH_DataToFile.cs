using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using Selva.Grasshopper.Config;
using Selva.Grasshopper.Features.FileIO.Services;
using Selva.Grasshopper.Properties;
using Selva.Grasshopper.Utilities;
using Point = Rhino.Geometry.Point;

namespace Selva.Grasshopper.Features.FileIO.Components;

public class GH_DataToFile : GH_Component
{
	private const string DefaultLayerName = "Default";
	private const string DefaultFileEnding = ".3dm";
	private static readonly Color DefaultLayerColor = Color.Black;

	// Singleton converter instance (reused across all solve instances)
	private static RhinoDocumentConverter _converter;
	private static readonly object _converterLock = new();

	/// <summary>
	///   Initializes a new instance of the DataToFile class.
	/// </summary>
	public GH_DataToFile()
		: base("Geometry To File", "GTF",
			"Exports geometry to file format(s) with layer organization. Supports both single file (list input) and multiple files (tree input).",
			"Selva", "IO")
	{
		EnsureConverterInitialized();
	}

	/// <summary>
	///   Provides an Icon for the component.
	/// </summary>
	protected override Bitmap Icon => Resources.DataToFile;

	/// <summary>
	///   Gets the unique ID for this component. Do not change this ID after release.
	/// </summary>
	public override Guid ComponentGuid => new("A51C8F6A-D422-4387-8170-F9F34D8E5351");

	/// <summary>
	///   Creates custom component attributes
	/// </summary>
	public override void CreateAttributes()
	{
		m_attributes = new GH_ContextBakeOutputAttributes(this);
	}

	/// <summary>
	///   Ensures the converter is initialized (singleton pattern)
	/// </summary>
	private void EnsureConverterInitialized()
	{
		if (_converter == null)
			lock (_converterLock)
			{
				if (_converter == null)
				{
					// Configure options for Grasshopper usage
					var options = new AppConfig.RhinoConverterOptions();

					_converter = new RhinoDocumentConverter(options);
				}
			}
	}

	/// <summary>
	///   Registers all the input parameters for this component.
	/// </summary>
	protected override void RegisterInputParams(GH_InputParamManager pManager)
	{
		pManager.AddGeometryParameter("Geometry", "G",
			"Geometry to be exported. Use list for single file, tree for multiple files (one per branch)",
			GH_ParamAccess.tree);
		pManager.AddTextParameter("Layer Names", "L",
			"Names of the layers. Use list for single file, tree for multiple files",
			GH_ParamAccess.tree);
		pManager.AddColourParameter("Layer Colors", "C",
			"Colors of the layers. Use list for single file, tree for multiple files",
			GH_ParamAccess.tree);
		pManager.AddTextParameter("File Names", "F",
			"Name(s) of the file. Use single value for list input, or tree for multiple files",
			GH_ParamAccess.tree);
		pManager.AddTextParameter("File Ending", "E",
			"File ending of the geometry",
			GH_ParamAccess.item, DefaultFileEnding);

		pManager[1].Optional = true;
		pManager[2].Optional = true;
		pManager[4].Optional = true;
	}

	/// <summary>
	///   Registers all the output parameters for this component.
	/// </summary>
	protected override void RegisterOutputParams(GH_OutputParamManager pManager)
	{
		pManager.AddGenericParameter("File", "F",
			"Exported file data. Single item for list input, multiple items for tree input",
			GH_ParamAccess.list);
	}

	/// <summary>
	///   This is the method that actually does the work.
	/// </summary>
	protected override void SolveInstance(IGH_DataAccess DA)
	{
		// Get trees for all parameters
		if (!DA.GetDataTree(0, out GH_Structure<IGH_GeometricGoo> geometryTree))
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry provided");
			return;
		}

		DA.GetDataTree(1, out GH_Structure<GH_String> layerNamesTree);
		DA.GetDataTree(2, out GH_Structure<GH_Colour> layerColorsTree);

		if (!DA.GetDataTree(3, out GH_Structure<GH_String> fileNamesTree))
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "File name(s) not provided");
			return;
		}

		var fileEnding = DefaultFileEnding;
		DA.GetData(4, ref fileEnding);

		// Validate file ending
		if (string.IsNullOrWhiteSpace(fileEnding) || !fileEnding.StartsWith("."))
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
				$"Invalid file ending '{fileEnding}'. Using default {DefaultFileEnding}");
			fileEnding = DefaultFileEnding;
		}

		try
		{
			List<FileDataGoo> results;

			// Determine if we're in single file mode (simple list) or multiple file mode (tree structure)
			if (IsSingleFileMode(geometryTree))
				// Single file mode - all geometry in one file
				results = ProcessSingleFile(geometryTree, layerNamesTree, layerColorsTree, fileNamesTree, fileEnding);
			else
				// Multiple files mode - one file per branch
				results = ProcessMultipleFiles(geometryTree, layerNamesTree, layerColorsTree, fileNamesTree,
					fileEnding);

			if (results.Count == 0)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No files were successfully created");
				return;
			}

			DA.SetDataList(0, results);
		}
		catch (Exception ex)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error, $"Error processing geometry: {ex.Message}");
		}
	}

	/// <summary>
	///   Determines if the component should operate in single file mode based on tree structure.
	/// </summary>
	private bool IsSingleFileMode(GH_Structure<IGH_GeometricGoo> geometryTree)
	{
		return geometryTree.PathCount == 1 ||
		       (geometryTree.PathCount > 1 && geometryTree.Branches.Skip(1).All(b => b.Count == 0));
	}

	/// <summary>
	///   Processes all geometry into a single file.
	/// </summary>
	private List<FileDataGoo> ProcessSingleFile(
		GH_Structure<IGH_GeometricGoo> geometryTree,
		GH_Structure<GH_String> layerNamesTree,
		GH_Structure<GH_Colour> layerColorsTree,
		GH_Structure<GH_String> fileNamesTree,
		string fileEnding)
	{
		var results = new List<FileDataGoo>();

		// Flatten all data
		var allGeometry = geometryTree.AllData(true).OfType<IGH_GeometricGoo>().ToList();
		var allLayerNames = layerNamesTree?.AllData(true)
			.Select(s => (s as GH_String)?.Value)
			.ToList() ?? new List<string>();
		var allLayerColors = layerColorsTree?.AllData(true)
			.Select(c => (c as GH_Colour)?.Value ?? DefaultLayerColor)
			.ToList() ?? new List<Color>();
		var allFileNames = fileNamesTree?.AllData(true)
			.Select(s => (s as GH_String)?.Value)
			.Where(s => !string.IsNullOrWhiteSpace(s))
			.ToList() ?? new List<string>();

		if (allGeometry.Count == 0)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry found");
			return results;
		}

		var fileName = allFileNames.FirstOrDefault() ?? "export";

		var validGeometries = ExtractValidGeometries(allGeometry);

		if (validGeometries.Count == 0)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "No valid geometry found to export");
			return results;
		}

		RhinoDoc doc = null;
		try
		{
			doc = RhinoDoc.CreateHeadless(null);
			if (doc == null)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Failed to create Rhino document");
				return results;
			}

			AddGeometriesToDocument(doc, validGeometries, allLayerNames, allLayerColors);

			var base64String = ExportDocument(doc, fileEnding);

			if (!string.IsNullOrEmpty(base64String))
			{
				var fileData = new FileData
				{
					FileName = fileName,
					Data = base64String,
					FileType = fileEnding,
					IsBase64Encoded = true
				};
				results.Add(new FileDataGoo(fileData));
			}
			else
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Error, "Failed to export file");
			}
		}
		finally
		{
			doc?.Dispose();
		}

		return results;
	}

	/// <summary>
	///   Processes geometry into multiple files, one per branch.
	/// </summary>
	private List<FileDataGoo> ProcessMultipleFiles(
		GH_Structure<IGH_GeometricGoo> geometryTree,
		GH_Structure<GH_String> layerNamesTree,
		GH_Structure<GH_Colour> layerColorsTree,
		GH_Structure<GH_String> fileNamesTree,
		string fileEnding)
	{
		var results = new List<FileDataGoo>();
		var paths = geometryTree.Paths.ToList();

		for (var pathIndex = 0; pathIndex < paths.Count; pathIndex++)
		{
			var path = paths[pathIndex];
			var geometryBranch = geometryTree.get_Branch(path);

			if (geometryBranch == null || geometryBranch.Count == 0) continue;

			try
			{
				var layerNamesBranch = layerNamesTree?.get_Branch(path)?.Cast<GH_String>().ToList() ??
				                       new List<GH_String>();
				var layerColorsBranch = layerColorsTree?.get_Branch(path)?.Cast<GH_Colour>().ToList() ??
				                        new List<GH_Colour>();
				var fileNamesBranch = fileNamesTree?.get_Branch(path)?.Cast<GH_String>().ToList() ??
				                      new List<GH_String>();

				var branchGeometry = geometryBranch.OfType<IGH_GeometricGoo>().ToList();
				var branchLayerNames = layerNamesBranch
					.Select(s => s?.Value)
					.ToList();
				var branchLayerColors = layerColorsBranch
					.Select(c => c?.Value ?? DefaultLayerColor)
					.ToList();
				var branchFileNames = fileNamesBranch
					.Select(s => s?.Value)
					.Where(s => !string.IsNullOrWhiteSpace(s))
					.ToList();

				var fileName = branchFileNames.FirstOrDefault() ?? $"export_{pathIndex}";
				var validGeometries = ExtractValidGeometries(branchGeometry);

				if (validGeometries.Count == 0)
				{
					AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
						$"No valid geometry found in branch {path}");
					continue;
				}

				RhinoDoc doc = null;
				try
				{
					doc = RhinoDoc.CreateHeadless(null);
					if (doc == null)
					{
						AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
							$"Failed to create document for branch {path}");
						continue;
					}

					AddGeometriesToDocument(doc, validGeometries, branchLayerNames, branchLayerColors);

					var base64String = ExportDocument(doc, fileEnding);

					if (!string.IsNullOrEmpty(base64String))
					{
						var fileData = new FileData
						{
							FileName = fileName,
							Data = base64String,
							FileType = fileEnding,
							IsBase64Encoded = true
						};
						results.Add(new FileDataGoo(fileData));
					}
					else
					{
						AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
							$"Failed to export file for branch {path}");
					}
				}
				finally
				{
					doc?.Dispose();
				}
			}
			catch (Exception ex)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
					$"Error processing branch {path}: {ex.Message}");
			}
		}

		return results;
	}

	/// <summary>
	///   Extracts valid GeometryBase objects from IGH_GeometricGoo list with detailed error handling.
	/// </summary>
	private List<(GeometryBase Geometry, int OriginalIndex)> ExtractValidGeometries(List<IGH_GeometricGoo> gooList)
	{
		var validGeometries = new List<(GeometryBase, int)>();

		for (var i = 0; i < gooList.Count; i++)
		{
			var goo = gooList[i];

			if (goo == null) continue;

			GeometryBase geometry = null;

			try
			{
				var scriptVar = goo.ScriptVariable();
				if (scriptVar is GeometryBase geomBase)
					geometry = geomBase;
				else if (goo is GH_Mesh ghMesh && ghMesh.Value != null)
					geometry = ghMesh.Value;
				else if (goo is GH_Brep ghBrep && ghBrep.Value != null)
					geometry = ghBrep.Value;
				else if (goo is GH_Surface ghSurface && ghSurface.Value != null)
					geometry = ghSurface.Value;
				else if (goo is GH_Curve ghCurve && ghCurve.Value != null)
					geometry = ghCurve.Value;
				else if (goo is GH_Box ghBox && ghBox.Value.IsValid)
					geometry = ghBox.Value.ToBrep();
				else if (goo is GH_Point ghPoint)
					geometry = new Point(ghPoint.Value);
				else if (goo is GH_Line ghLine && ghLine.Value.IsValid)
					geometry = new LineCurve(ghLine.Value);
				else if (goo is GH_Circle ghCircle && ghCircle.Value.IsValid)
					geometry = new ArcCurve(ghCircle.Value);
				else if (goo is GH_Arc ghArc && ghArc.Value.IsValid) geometry = new ArcCurve(ghArc.Value);

				if (geometry != null && geometry.IsValid) validGeometries.Add((geometry, i));
			}
			catch (Exception ex)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
					$"Error extracting geometry at index {i}: {ex.Message}");
			}
		}

		return validGeometries;
	}

	/// <summary>
	///   Adds geometries to the Rhino document with proper layer management.
	/// </summary>
	private void AddGeometriesToDocument(RhinoDoc doc,
		List<(GeometryBase Geometry, int OriginalIndex)> geometries,
		List<string> layerNames,
		List<Color> layerColors)
	{
		// Create a dictionary to track layers and avoid duplicates
		var layerCache = new Dictionary<string, int>();

		foreach (var (geometry, originalIndex) in geometries)
			try
			{
				var layerName = GetLayerName(layerNames, originalIndex);
				var layerColor = GetLayerColor(layerColors, originalIndex);

				int layerIndex;

				if (!layerCache.TryGetValue(layerName, out layerIndex))
				{
					layerIndex = doc.Layers.FindByFullPath(layerName, RhinoMath.UnsetIntIndex);

					if (layerIndex == RhinoMath.UnsetIntIndex)
					{
						var layer = new Layer
						{
							Name = layerName,
							Color = layerColor
						};

						layerIndex = doc.Layers.Add(layer);

						if (layerIndex < 0)
						{
							AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
								$"Failed to create layer '{layerName}' for geometry at index {originalIndex}");
							continue;
						}
					}

					layerCache[layerName] = layerIndex;
				}

				var attributes = new ObjectAttributes
				{
					LayerIndex = layerIndex,
					Name = layerName
				};

				var objectId = doc.Objects.Add(geometry, attributes);

				if (objectId == Guid.Empty)
					AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
						$"Failed to add geometry at index {originalIndex} to document");
			}
			catch (Exception ex)
			{
				AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
					$"Error processing geometry at index {originalIndex}: {ex.Message}");
			}
	}

	/// <summary>
	///   Gets the layer name for a specific index with fallback to default.
	/// </summary>
	private string GetLayerName(List<string> layerNames, int index)
	{
		if (layerNames == null || layerNames.Count == 0) return DefaultLayerName;

		if (index < layerNames.Count && !string.IsNullOrWhiteSpace(layerNames[index])) return layerNames[index];

		var lastName = layerNames.LastOrDefault(n => !string.IsNullOrWhiteSpace(n));
		return lastName ?? DefaultLayerName;
	}

	/// <summary>
	///   Gets the layer color for a specific index with fallback to default.
	/// </summary>
	private Color GetLayerColor(List<Color> layerColors, int index)
	{
		if (layerColors == null || layerColors.Count == 0) return DefaultLayerColor;

		if (index < layerColors.Count) return layerColors[index];

		return layerColors.Count > 0 ? layerColors[layerColors.Count - 1] : DefaultLayerColor;
	}

	/// <summary>
	///   Exports the document to the specified file format using the new converter.
	/// </summary>
	private string ExportDocument(RhinoDoc doc, string fileEnding)
	{
		try
		{
			if (fileEnding == ".3dm") return _converter.DocToRhinoFile(doc); // Synchronous!

			return _converter.DocToBase64(doc, fileEnding); // Synchronous!
		}
		catch (Exception ex)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error,
				$"Error during file export: {ex.Message}");
			return null;
		}
	}
}
