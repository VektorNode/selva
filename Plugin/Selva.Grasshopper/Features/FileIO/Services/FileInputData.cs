using System;
using Newtonsoft.Json;

namespace Selva.Grasshopper.Features.FileIO.Services;

/// <summary>
///   Represents file input data from web UI or local sources.
///   Supports three input modes: local path, URL, or base64-encoded file data.
/// </summary>
public class FileInputData
{
	/// <summary>
	///   Gets or sets the file data. Can be a local path, URL, or base64-encoded string.
	/// </summary>
	[JsonProperty("file")]
	public string File { get; set; }

	/// <summary>
	///   Gets or sets the input type: "path", "url", or "base64".
	/// </summary>
	[JsonProperty("type")]
	public string Type { get; set; }

	/// <summary>
	///   Gets or sets the file extension (e.g., ".step", ".3dm"). Required for base64 mode.
	/// </summary>
	[JsonProperty("fileEnding")]
	public string FileEnding { get; set; }

	/// <summary>
	///   Creates a FileInputData from a local file path (auto-detects extension).
	/// </summary>
	public static FileInputData FromPath(string path)
	{
		return new FileInputData
		{
			File = path,
			Type = "path",
			FileEnding = System.IO.Path.GetExtension(path)
		};
	}

	/// <summary>
	///   Creates a FileInputData from a URL (auto-detects extension from URL).
	/// </summary>
	public static FileInputData FromUrl(string url)
	{
		var extension = System.IO.Path.GetExtension(new Uri(url).LocalPath);
		return new FileInputData
		{
			File = url,
			Type = "url",
			FileEnding = extension
		};
	}

	/// <summary>
	///   Creates a FileInputData from base64-encoded data.
	/// </summary>
	public static FileInputData FromBase64(string base64Data, string fileEnding)
	{
		return new FileInputData
		{
			File = base64Data,
			Type = "base64",
			FileEnding = fileEnding
		};
	}
}
