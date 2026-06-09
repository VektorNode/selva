using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     Represents the data and metadata for a file to be processed or stored.
/// </summary>
public class FileData
{
    /// <summary>
    ///     Gets or sets a unique identifier for this file data.
    /// </summary>
    [JsonProperty("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    ///     Gets or sets the base name of the file, WITHOUT extension.
    ///     The full filename is constructed as FileName + FileType by the client.
    /// </summary>
    [JsonProperty("fileName")]
    public string FileName { get; set; }

    /// <summary>
    ///     Gets or sets the file's contents as a string.
    /// </summary>
    [JsonProperty("data")]
    public string Data { get; set; }

    /// <summary>
    ///     Gets or sets the file type/extension (e.g., ".3dm"). The dot is important.
    /// </summary>
    [JsonProperty("fileType")]
    public string FileType { get; set; } //Example .3dm -> Important with point

    /// <summary>
    ///     Gets or sets a value indicating whether the file data is Base64 encoded.
    /// </summary>
    [JsonProperty("isBase64Encoded")]
    public bool IsBase64Encoded { get; set; }

    /// <summary>
    ///     Gets or sets the subfolder path where the file should be stored. Defaults to an empty string.
    /// </summary>
    [JsonProperty("subFolder")]
    public string SubFolder { get; set; } = "";

    /// <summary>
    ///     Gets or sets arbitrary user-supplied metadata (e.g. tags, indexing keys).
    ///     The plugin does not interpret these values; they ride along with the file
    ///     payload for downstream consumers (tagging, indexing, etc.).
    /// </summary>
    [JsonProperty("metadata")]
    public Dictionary<string, string> Metadata { get; set; } = new();
}
