using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino.Geometry;
using Selva.Core.Models;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Services;
using Selva.GH.Properties;
using static Selva.GH.Features.ComputeIO.Components.GetValueListParameter;
using Point = Rhino.Geometry.Point;

namespace Selva.GH.Features.ComputeIO.Components;

/// <summary>
///   A contextual component that imports geometry from files (local path, URL, or base64).
///   Outputs geometry on output 0 and the source filename (with extension) on output 1.
///   Supported formats are defined in AcceptedFileFormats.Values (schema-driven).
/// </summary>
public class GetFileParameter : GH_Component, IGH_ContextualParameter
{
	// Constants for validation and limits
	private const int MaxContextualDataItems = 100;
	private const int MaxFileDataSize = AppConfig.ValueLimits.MaxBase64StringLength;
	private const int MaxJsonDepth = AppConfig.JsonSerialization.MaxJsonDepth;
	private const int MaxPathLength = 32767; // Windows MAX_PATH

	// Reused across every solve — avoids per-call array allocations
	private static readonly HashSet<string> ValidTypes =
		new(StringComparer.OrdinalIgnoreCase) { "path", "url", "base64" };

	private FileInputData _contextualFileData;

	// Cached solve results — set during SolveInstance, read by output params
	private List<IGH_GeometricGoo> _solvedGeometry = new();
	private string _solvedFileName = "";

	public GetFileParameter()
		: base("Get File", "Get File",
			"Import geometry from file (path, URL, or upload)",
			"Params", "Util")
	{
	}

	public override GH_Exposure Exposure => GH_Exposure.quinary;
	public override Guid ComponentGuid => new("F6F335A4-70C8-41BD-964C-3CD0BDD58118");
	protected override Bitmap Icon => ContextualiseIcon(Resources.DataToFile);

	// ── IGH_ContextualParameter ────────────────────────────────────────────────
	public string Prompt { get; set; } = "Select a file to import";
	public int AtLeast { get; set; } = 1;
	public int AtMost { get; set; } = 1;
	public bool Immediate { get; set; } = true;
	public bool TreeAccess { get; set; }

	public IEnumerable<object> ContextualData
	{
		get
		{
			if (_contextualFileData != null) yield return new FileInputGoo(_contextualFileData);
		}
	}

	public void AssignContextualData(IEnumerable data)
	{
		_contextualFileData = null;

		if (data == null)
		{
			ExpireSolution(false);
			return;
		}

		try
		{
			var count = 0;
			foreach (var item in data)
			{
				if (++count > MaxContextualDataItems)
				{
					AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "Too many contextual data items");
					break;
				}

				var fileData = ExtractFileInputData(item);
				if (fileData != null)
				{
					if (ValidateFileInputData(fileData))
					{
						_contextualFileData = fileData;
						break; // AtMost = 1
					}
					else
					{
						AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
							$"File data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
					}
				}
			}
		}
		catch (Exception ex)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
				$"Error assigning contextual data: {ex.Message}");
		}

		ExpireSolution(false);
	}

	/// <summary>
	///   Called by Rhino.Compute via reflection — receives data as DataTree of GH_String.
	/// </summary>
	public void AssignContextualDataTree(DataTree<GH_String> data)
	{
		_contextualFileData = null;

		if (data == null || data.BranchCount == 0)
		{
			ExpireSolution(false);
			return;
		}

		try
		{
			var firstPath = data.Paths.FirstOrDefault();
			if (firstPath != null)
			{
				var branch = data.Branch(firstPath);
				if (branch != null && branch.Count > 0)
				{
					var fileData = ExtractFileInputData(branch[0]);
					if (fileData != null && ValidateFileInputData(fileData))
					{
						_contextualFileData = fileData;
					}
					else if (fileData != null)
					{
						AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
							$"File data validation failed. Size: {fileData.File?.Length ?? 0} chars (Max: {MaxFileDataSize})");
					}
				}
			}
		}
		catch (Exception ex)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning,
				$"Error assigning contextual data tree: {ex.Message}");
		}

		ExpireSolution(false);
	}

	public bool AutoAssignContextualData(GH_ParameterContext context)
	{
		return _contextualFileData != null;
	}

	public void ClearContextualData()
	{
		_contextualFileData = null;
	}

	/// <summary>
	///   Returns contextual JSON for web UI schema discovery.
	/// </summary>
	public JObject GetContextualJson()
	{
		return new JObject
		{
			{ "description", Description ?? "" },
			{ "name", Name },
			{ "nickname", NickName },
			{ "treeAccess", TreeAccess },
			{ "paramType", "File" },
			{ "acceptedFormats", new JArray(AcceptedFileFormats.Values) }
		};
	}

	// ── GH_Component ──────────────────────────────────────────────────────────

	protected override void RegisterInputParams(GH_InputParamManager pManager)
	{
		// Optional manual source: a file path or JSON string wired in from GH
		pManager.AddTextParameter("File", "F",
			"Optional: wire a file path or JSON string. Leave disconnected to use the web UI upload.",
			GH_ParamAccess.item);
		pManager[0].Optional = true;
	}

	protected override void RegisterOutputParams(GH_OutputParamManager pManager)
	{
		pManager.AddGeometryParameter("Geometry", "G", "Imported geometry", GH_ParamAccess.list);
		pManager.AddTextParameter("File Name", "N", "File name with extension (e.g. model.3dm)", GH_ParamAccess.item);
	}

	protected override void SolveInstance(IGH_DataAccess DA)
	{
		_solvedGeometry = new List<IGH_GeometricGoo>();
		_solvedFileName = "";

		FileInputData fileData = null;

		// Priority 1: contextual data from web UI
		if (_contextualFileData != null)
		{
			fileData = _contextualFileData;
		}
		else
		{
			// Priority 2: manual wire input
			var inputStr = "";
			if (DA.GetData(0, ref inputStr) && !string.IsNullOrEmpty(inputStr))
				fileData = ExtractFileInputData(new GH_String(inputStr));
		}

		if (fileData == null)
		{
			DA.SetDataList(0, _solvedGeometry);
			DA.SetData(1, _solvedFileName);
			return;
		}

		_solvedFileName = ResolveFileName(fileData);

		var result = FileImporter.ImportFromFileInputData(fileData);
		if (!result.Success)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error, result.ErrorMessage);
			DA.SetDataList(0, _solvedGeometry);
			DA.SetData(1, _solvedFileName);
			return;
		}

		if (result.Geometry.Count == 0)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry found in file");
			DA.SetDataList(0, _solvedGeometry);
			DA.SetData(1, _solvedFileName);
			return;
		}

		foreach (var item in result.Geometry)
		{
			var geo = item.Geometry;
			if (geo == null) continue;

			IGH_GeometricGoo goo = geo switch
			{
				Curve curve => new GH_Curve(curve),
				Brep brep => new GH_Brep(brep),
				Mesh mesh => new GH_Mesh(mesh),
				Surface surface => new GH_Surface(surface),
				Point point => new GH_Point(point.Location),
				_ => null
			};

			if (goo != null) _solvedGeometry.Add(goo);
		}

		DA.SetDataList(0, _solvedGeometry);
		DA.SetData(1, _solvedFileName);

		AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
			$"Imported {_solvedGeometry.Count} objects from {result.DetectedFormat}");
	}

	// ── Serialization ──────────────────────────────────────────────────────────

	public override bool Write(GH_IWriter writer)
	{
		writer.SetString("Prompt", Prompt ?? string.Empty);
		writer.SetInt32("AtLeast", AtLeast);
		writer.SetInt32("AtMost", AtMost);
		writer.SetBoolean("TreeAccess", TreeAccess);
		writer.SetBoolean("Immediate", Immediate);
		return base.Write(writer);
	}

	public override bool Read(GH_IReader reader)
	{
		try
		{
			Prompt = reader.GetString("Prompt") ?? "Select a file to import";

			var atLeast = 1;
			if (reader.TryGetInt32("AtLeast", ref atLeast)) AtLeast = atLeast;

			var atMost = 1;
			if (reader.TryGetInt32("AtMost", ref atMost)) AtMost = atMost;

			var treeAccess = false;
			if (reader.TryGetBoolean("TreeAccess", ref treeAccess)) TreeAccess = treeAccess;

			var immediate = true;
			if (reader.TryGetBoolean("Immediate", ref immediate)) Immediate = immediate;
		}
		catch (Exception ex)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, $"Error reading saved data: {ex.Message}");
		}

		return base.Read(reader);
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	/// <summary>
	///   Derives a display filename from FileInputData.
	///   - path: last segment of the path (e.g. "model.3dm")
	///   - url:  last segment of the URL path, stripped of query strings
	///   - base64: synthetic name using the file ending (e.g. "upload.step")
	/// </summary>
	private static string ResolveFileName(FileInputData fileData)
	{
		if (fileData == null) return "";

		try
		{
			switch (fileData.Type?.ToLowerInvariant())
			{
				case "path":
					return System.IO.Path.GetFileName(fileData.File) ?? "";

				case "url":
					var path = new Uri(fileData.File).AbsolutePath;
					// Strip query string already handled by AbsolutePath
					return System.IO.Path.GetFileName(path) ?? "";

				case "base64":
					var ext = fileData.FileEnding ?? "";
					if (!ext.StartsWith(".")) ext = "." + ext;
					return "upload" + ext;

				default:
					// Unknown type — try path extraction as fallback
					return System.IO.Path.GetFileName(fileData.File) ?? "";
			}
		}
		catch
		{
			return fileData.FileEnding ?? "";
		}
	}

	/// <summary>
	///   Extracts FileInputData from various input types.
	/// </summary>
	private static FileInputData ExtractFileInputData(object item)
	{
		return item switch
		{
			null => null,
			FileInputGoo goo => goo.Value,
			FileInputData data => data,
			GH_String ghString => TryParseFileInputDataFromString(ghString.Value),
			IGH_Goo goo => TryParseFileInputDataFromString(goo.ScriptVariable()?.ToString()),
			string str => TryParseFileInputDataFromString(str),
			_ => null
		};
	}

	/// <summary>
	///   Attempts to parse a string as FileInputData JSON, URL, or absolute local path.
	///   Returns null for relative paths, invalid strings, and oversized strings.
	/// </summary>
	private static FileInputData TryParseFileInputDataFromString(string str)
	{
		if (string.IsNullOrEmpty(str)) return null;

		if (str.Length > MaxFileDataSize) return null;

		// Try JSON first
		try
		{
			var settings = new JsonSerializerSettings
			{
				MaxDepth = MaxJsonDepth,
				TypeNameHandling = TypeNameHandling.None
			};

			var data = JsonConvert.DeserializeObject<FileInputData>(str, settings);
			if (data != null && !string.IsNullOrEmpty(data.File))
			{
				if (data.Type != null && !ValidTypes.Contains(data.Type))
					return null;
				return data;
			}
		}
		catch (JsonException)
		{
			// Not JSON — fall through
		}
		catch (Exception)
		{
			return null;
		}

		if (str.Length > MaxPathLength) return null;

		// Only accept rooted absolute paths
		if (!System.IO.Path.IsPathRooted(str)) return null;

		try
		{
			return FileInputData.FromPath(str);
		}
		catch
		{
			return null;
		}
	}

	/// <summary>
	///   Validates FileInputData for security and format constraints.
	/// </summary>
	private static bool ValidateFileInputData(FileInputData fileData)
	{
		if (fileData == null || string.IsNullOrWhiteSpace(fileData.File)) return false;

		if (fileData.File.Length > MaxFileDataSize) return false;

		if (fileData.Type != null && !ValidTypes.Contains(fileData.Type)) return false;

		if (fileData.FileEnding != null &&
				!AcceptedFileFormats.Values.Contains(fileData.FileEnding.ToLowerInvariant()))
			return false;

		return true;
	}
}
