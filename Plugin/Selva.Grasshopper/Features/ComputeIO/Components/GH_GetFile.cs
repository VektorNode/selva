using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using GH_IO.Serialization;
using Grasshopper.Kernel;
using Grasshopper.Kernel.Data;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Rhino.Geometry;
using Selva.Grasshopper.Features.FileIO.Services;
using Selva.Grasshopper.Properties;
using static Selva.Grasshopper.Features.ComputeIO.Components.GetValueListParameter;
using Point = Rhino.Geometry.Point;

namespace Selva.Grasshopper.Features.ComputeIO.Components;

/// <summary>
///   A contextual parameter that imports geometry from files (local path, URL, or base64).
///   Supports: 3dm, STEP, IGES, DXF, DWG, OBJ, FBX, GLB
/// </summary>
public class GetFileParameter : GH_Param<IGH_GeometricGoo>, IGH_ContextualParameter
{
	private FileInputData _contextualFileData;
	private bool _isFromContextual;

	public GetFileParameter()
		: base("Get File", "Get File", "Import geometry from file (path, URL, or upload)", "Params", "Util",
			GH_ParamAccess.list)
	{
	}


	public override GH_Exposure Exposure => GH_Exposure.quinary;

	public override string TypeName => "File";
	public override Guid ComponentGuid => new("B4F6E8D2-9A3C-4E7B-8D1F-5A9C7E2B4D6F");

	protected override Bitmap Internal_Icon_24x24 => ContextualiseIcon(Resources.GetValueList);

	// IGH_ContextualParameter properties
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

		foreach (var item in data)
		{
			var fileData = ExtractFileInputData(item);
			if (fileData != null)
			{
				_contextualFileData = fileData;
				_isFromContextual = true;
				break; // Only take first item (AtMost = 1)
			}
		}

		ExpireSolution(false);
	}

	public bool AutoAssignContextualData(GH_ParameterContext context)
	{
		// Auto-assign when contextual data is available
		return _contextualFileData != null;
	}

	public void ClearContextualData()
	{
		_contextualFileData = null;
		_isFromContextual = false;
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
			{ "treeAccess", Access == GH_ParamAccess.tree },
			{ "paramType", TypeName },
			{
				"acceptedFormats",
				new JArray(".3dm", ".stp", ".step", ".igs", ".iges", ".dxf", ".dwg", ".obj", ".fbx", ".glb", ".gltf")
			}
		};
	}

	protected override void CollectVolatileData_FromSources()
	{
		m_data.Clear();

		// Priority 1: Contextual data from web UI (auto-import)
		if (_contextualFileData != null && _isFromContextual)
		{
			ImportAndOutputGeometry(_contextualFileData);
			return;
		}

		// Priority 2: Manual input from text/path component
		foreach (var source in Sources)
		{
			if (source == null) continue;

			foreach (var item in source.VolatileData.AllData(true))
			{
				var fileData = ExtractFileInputData(item);
				if (fileData != null)
				{
					ImportAndOutputGeometry(fileData);
					return; // Only process first valid file
				}
			}
		}
	}

	/// <summary>
	///   Imports geometry from FileInputData and outputs to m_data.
	/// </summary>
	private void ImportAndOutputGeometry(FileInputData fileData)
	{
		if (fileData == null)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No file data provided");
			return;
		}

		var result = FileImporter.ImportFromFileInputData(fileData);

		if (!result.Success)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Error, result.ErrorMessage);
			return;
		}

		if (result.Geometry.Count == 0)
		{
			AddRuntimeMessage(GH_RuntimeMessageLevel.Warning, "No geometry found in file");
			return;
		}

		// Convert to IGH_GeometricGoo
		var ghGeometry = new List<IGH_GeometricGoo>();

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

			if (goo != null) ghGeometry.Add(goo);
		}

		m_data.AppendRange(ghGeometry, new GH_Path(0));

		// Success message
		AddRuntimeMessage(GH_RuntimeMessageLevel.Remark,
			$"Imported {ghGeometry.Count} objects from {result.DetectedFormat}");
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
			string str => TryParseFileInputDataFromString(str),
			_ => null
		};
	}

	/// <summary>
	///   Attempts to parse a string as FileInputData JSON or fallback to path.
	/// </summary>
	private static FileInputData TryParseFileInputDataFromString(string str)
	{
		if (string.IsNullOrEmpty(str)) return null;

		// Try to parse as JSON first
		try
		{
			var data = JsonConvert.DeserializeObject<FileInputData>(str);
			if (data != null && !string.IsNullOrEmpty(data.File)) return data;
		}
		catch
		{
			// Not JSON, treat as path
		}

		// Fallback: treat as file path
		return FileInputData.FromPath(str);
	}

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
		Prompt = reader.GetString("Prompt");

		var atLeast = 1;
		if (reader.TryGetInt32("AtLeast", ref atLeast)) AtLeast = atLeast;

		var atMost = 1;
		if (reader.TryGetInt32("AtMost", ref atMost)) AtMost = atMost;

		var treeAccess = false;
		if (reader.TryGetBoolean("TreeAccess", ref treeAccess)) TreeAccess = treeAccess;

		var immediate = true;
		if (reader.TryGetBoolean("Immediate", ref immediate)) Immediate = immediate;

		return base.Read(reader);
	}
}
