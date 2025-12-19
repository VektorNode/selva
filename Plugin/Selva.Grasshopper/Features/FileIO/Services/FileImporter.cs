using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Rhino;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;

namespace Selva.Grasshopper.Features.FileIO.Services;

/// <summary>
///   Centralizes file import logic for multiple file formats.
///   Supports: 3dm, STEP, IGES, DXF, DWG, OBJ, FBX, GLB
/// </summary>
public static class FileImporter
{
	private const int MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
	private const int DOWNLOAD_TIMEOUT_SECONDS = 30;

	/// <summary>
	///   Imports a file from path, URL, or base64 data.
	/// </summary>
	public static (bool Success, List<GeometryWithName> Geometry, string DetectedFormat, string ErrorMessage)
		ImportFromFileInputData(FileInputData fileData)
	{
		if (fileData == null || string.IsNullOrEmpty(fileData.File))
			return (false, new List<GeometryWithName>(), "", "File data is null or empty");

		string tempPath = null;
		try
		{
			// Resolve to local file path based on input type
			switch (fileData.Type?.ToLowerInvariant())
			{
				case "path":
					tempPath = fileData.File;
					break;

				case "url":
					var downloadResult = DownloadUrlToTempSync(fileData.File, fileData.FileEnding);
					if (!downloadResult.Success)
						return (false, new List<GeometryWithName>(), "", downloadResult.ErrorMessage);
					tempPath = downloadResult.TempPath;
					break;

				case "base64":
					var decodeResult = DecodeBase64ToTemp(fileData.File, fileData.FileEnding);
					if (!decodeResult.Success)
						return (false, new List<GeometryWithName>(), "", decodeResult.ErrorMessage);
					tempPath = decodeResult.TempPath;
					break;

				default:
					// Try to auto-detect: if starts with http/https, treat as URL, otherwise as path
					if (fileData.File.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
					    fileData.File.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
					{
						var autoDetectResult = DownloadUrlToTempSync(fileData.File, fileData.FileEnding);
						if (!autoDetectResult.Success)
							return (false, new List<GeometryWithName>(), "", autoDetectResult.ErrorMessage);
						tempPath = autoDetectResult.TempPath;
					}
					else
					{
						tempPath = fileData.File;
					}

					break;
			}

			// Import the file
			return ImportFile(tempPath);
		}
		finally
		{
			// Clean up temp file only if it was created by us (not for direct path input)
			if (!string.IsNullOrEmpty(tempPath) &&
			    fileData.Type?.ToLowerInvariant() != "path" &&
			    File.Exists(tempPath))
				try
				{
					File.Delete(tempPath);
				}
				catch
				{
					/* ignore cleanup errors */
				}
		}
	}

	/// <summary>
	///   Imports geometry from a file path. Detects format from extension.
	/// </summary>
	public static (bool Success, List<GeometryWithName> Geometry, string DetectedFormat, string ErrorMessage)
		ImportFile(string filePath)
	{
		if (string.IsNullOrEmpty(filePath))
			return (false, new List<GeometryWithName>(), "", "File path is empty");

		if (!File.Exists(filePath))
			return (false, new List<GeometryWithName>(), "", $"File not found: {filePath}");

		// Check file size
		var fileInfo = new FileInfo(filePath);
		if (fileInfo.Length > MAX_FILE_SIZE_BYTES)
			return (false, new List<GeometryWithName>(), "",
				$"File too large: {fileInfo.Length / 1024 / 1024}MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");

		var extension = Path.GetExtension(filePath).ToLowerInvariant();

		// Create headless Rhino document for import
		var doc = RhinoDoc.CreateHeadless(null);
		if (doc == null)
			return (false, new List<GeometryWithName>(), "", "Failed to create Rhino document");

		try
		{
			bool importSuccess;

			// Route to appropriate import method based on extension
			switch (extension)
			{
				case ".3dm":
					importSuccess = Import3dm(filePath, doc);
					break;

				case ".stp":
				case ".step":
					importSuccess = ImportStep(filePath, doc);
					break;

				case ".igs":
				case ".iges":
					importSuccess = ImportIges(filePath, doc);
					break;

				case ".dxf":
				case ".dwg":
				case ".obj":
				case ".fbx":
				case ".glb":
				case ".gltf":
					// Try generic import for these formats
					importSuccess = ImportGeneric(filePath, doc);
					break;

				default:
					// Unknown format - try generic import as fallback
					importSuccess = ImportGeneric(filePath, doc);
					break;
			}

			if (!importSuccess)
				return (false, new List<GeometryWithName>(), extension,
					$"Failed to import file with extension {extension}");

			// Extract geometry with metadata
			var geometryList = ExtractGeometryFromDocument(doc);

			return (true, geometryList, extension, "");
		}
		catch (Exception ex)
		{
			return (false, new List<GeometryWithName>(), extension, $"Import error: {ex.Message}");
		}
		finally
		{
			doc.Dispose();
		}
	}

	/// <summary>
	///   Downloads a file from URL to a temp file.
	/// </summary>
	private static (bool Success, string TempPath, string ErrorMessage) DownloadUrlToTempSync(string url,
		string fileEnding)
	{
		try
		{
			// Validate URL
			if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
				return (false, null, "Invalid URL format");

			if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
				return (false, null, "Only HTTP and HTTPS URLs are supported");

			// Create temp file path
			var extension = !string.IsNullOrEmpty(fileEnding)
				? fileEnding
				: Path.GetExtension(uri.LocalPath);
			var tempPath = Path.Combine(Path.GetTempPath(), $"selva_download_{Guid.NewGuid():N}{extension}");

			// Download (synchronous wrapper for async)
			var task = Task.Run(async () =>
			{
				using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(DOWNLOAD_TIMEOUT_SECONDS) };
				var response = await client.GetAsync(url);
				response.EnsureSuccessStatusCode();

				var bytes = await response.Content.ReadAsByteArrayAsync();

				// Check file size
				if (bytes.Length > MAX_FILE_SIZE_BYTES)
					return (false, null,
						$"Downloaded file too large: {bytes.Length / 1024 / 1024}MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");

				File.WriteAllBytes(tempPath, bytes);
				return (true, tempPath, "");
			});

			task.Wait();
			return task.Result;
		}
		catch (Exception ex)
		{
			return (false, null, $"Download failed: {ex.Message}");
		}
	}

	/// <summary>
	///   Decodes base64 data to a temp file.
	/// </summary>
	public static (bool Success, string TempPath, string ErrorMessage) DecodeBase64ToTemp(string base64Data,
		string fileEnding)
	{
		try
		{
			if (string.IsNullOrEmpty(base64Data))
				return (false, null, "Base64 data is empty");

			var bytes = Convert.FromBase64String(base64Data);

			// Check file size
			if (bytes.Length > MAX_FILE_SIZE_BYTES)
				return (false, null,
					$"Decoded file too large: {bytes.Length / 1024 / 1024}MB (max {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)");

			var extension = !string.IsNullOrEmpty(fileEnding) ? fileEnding : ".tmp";
			var tempPath = Path.Combine(Path.GetTempPath(), $"selva_base64_{Guid.NewGuid():N}{extension}");

			File.WriteAllBytes(tempPath, bytes);

			return (true, tempPath, "");
		}
		catch (FormatException)
		{
			return (false, null, "Invalid base64 format");
		}
		catch (Exception ex)
		{
			return (false, null, $"Base64 decode failed: {ex.Message}");
		}
	}

	/// <summary>
	///   Import .3dm file.
	/// </summary>
	private static bool Import3dm(string filePath, RhinoDoc doc)
	{
		try
		{
			return doc.Import(filePath);
		}
		catch
		{
			return false;
		}
	}

	/// <summary>
	///   Import STEP file (.stp, .step).
	/// </summary>
	private static bool ImportStep(string filePath, RhinoDoc doc)
	{
		try
		{
			var options = new FileStpReadOptions();
			return FileStp.Read(filePath, doc, options);
		}
		catch
		{
			return false;
		}
	}

	/// <summary>
	///   Import IGES file (.igs, .iges).
	///   Note: Falls back to generic import as FileIges may not be available in all Rhino versions.
	/// </summary>
	private static bool ImportIges(string filePath, RhinoDoc doc)
	{
		// FileIges.Read may not be available in all Rhino versions
		// Fall back to generic doc.Import() which should handle IGES
		return ImportGeneric(filePath, doc);
	}

	/// <summary>
	///   Generic import for other formats (DXF, DWG, OBJ, FBX, GLB, etc.).
	/// </summary>
	private static bool ImportGeneric(string filePath, RhinoDoc doc)
	{
		try
		{
			return doc.Import(filePath);
		}
		catch
		{
			return false;
		}
	}

	/// <summary>
	///   Extracts all geometry from a RhinoDoc, preserving block and layer metadata.
	/// </summary>
	private static List<GeometryWithName> ExtractGeometryFromDocument(RhinoDoc doc)
	{
		var geometryList = new List<GeometryWithName>();

		foreach (var obj in doc.Objects)
		{
			var layer = doc.Layers[obj.Attributes.LayerIndex];

			if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
			{
				var instanceGeo = obj.Geometry as InstanceReferenceGeometry;
				if (instanceGeo != null)
				{
					var idef = doc.InstanceDefinitions.FindId(instanceGeo.ParentIdefId);
					var blockName = idef?.Name ?? "Unknown Block";

					var blockGeometry = ExplodeInstanceRecursive(doc, instanceGeo, Transform.Identity, blockName);
					geometryList.AddRange(blockGeometry);
				}
			}
			else
			{
				var geo = obj.Geometry.Duplicate();
				if (geo != null)
				{
					geometryList.Add(new GeometryWithName(geo, "No Block", layer.Name));
				}
			}
		}

		return geometryList;
	}

	/// <summary>
	///   Recursively explodes block instances, preserving hierarchy and transformations.
	/// </summary>
	private static List<GeometryWithName> ExplodeInstanceRecursive(RhinoDoc doc,
		InstanceReferenceGeometry instanceRef,
		Transform parentTransform, string parentBlockName)
	{
		var geometryList = new List<GeometryWithName>();

		var idef = doc.InstanceDefinitions.FindId(instanceRef.ParentIdefId);
		if (idef == null) return geometryList;

		var combinedTransform = parentTransform * instanceRef.Xform;

		var currentBlockName = idef.Name;
		if (!string.IsNullOrEmpty(parentBlockName) && parentBlockName != "No Block")
			currentBlockName = $"{parentBlockName}::{currentBlockName}";

		var defObjects = idef.GetObjects();

		foreach (var obj in defObjects)
		{
			if (obj == null) continue;

			var layer = doc.Layers[obj.Attributes.LayerIndex];

			if (obj.Geometry.ObjectType == ObjectType.InstanceReference)
			{
				var nestedInstanceGeo = obj.Geometry as InstanceReferenceGeometry;
				if (nestedInstanceGeo != null)
				{
					var nestedGeometry = ExplodeInstanceRecursive(doc, nestedInstanceGeo, combinedTransform, currentBlockName);
					geometryList.AddRange(nestedGeometry);
				}
			}
			else
			{
				var geo = obj.Geometry.Duplicate();

				if (geo != null)
				{
					if (!combinedTransform.Equals(Transform.Identity))
					{
						if (combinedTransform.SimilarityType == TransformSimilarityType.NotSimilarity)
							if (!geo.MakeDeformable() && geo.ObjectType == ObjectType.Curve)
								if (geo is Curve crv)
									geo = crv.ToNurbsCurve();

						var transformSuccess = geo.Transform(combinedTransform);
						if (!transformSuccess) continue;

						if (combinedTransform.SimilarityType == TransformSimilarityType.OrientationReversing)
						{
							if (geo.ObjectType == ObjectType.Brep && geo is Brep brep)
								brep.Flip();
							else if (geo.ObjectType == ObjectType.Mesh && geo is Mesh mesh) mesh.Flip(true, true, true);
						}
					}

					geometryList.Add(new GeometryWithName(geo, currentBlockName, layer.Name));
				}
			}
		}

		return geometryList;
	}

	/// <summary>
	///   Represents geometry with associated block and layer metadata.
	/// </summary>
	public class GeometryWithName
	{
		public GeometryWithName(GeometryBase geometry, string blockName, string layerName = "")
		{
			Geometry = geometry;
			BlockName = blockName;
			LayerName = layerName;
		}

		public GeometryBase Geometry { get; set; }
		public string BlockName { get; set; }
		public string LayerName { get; set; }
	}
}
