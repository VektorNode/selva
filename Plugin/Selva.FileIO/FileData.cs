using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Selva.GH.Features.FileIO.Services;

public class FileData
{
    [JsonProperty("id")]
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>
    ///     Base name WITHOUT extension — the client builds the full filename as FileName + FileType.
    /// </summary>
    [JsonProperty("fileName")]
    public string FileName { get; set; }

    [JsonProperty("data")]
    public string Data { get; set; }

    /// <summary>
    ///     Extension including the leading dot (e.g. ".3dm").
    /// </summary>
    [JsonProperty("fileType")]
    public string FileType { get; set; }

    [JsonProperty("isBase64Encoded")]
    public bool IsBase64Encoded { get; set; }

    [JsonProperty("subFolder")]
    public string SubFolder { get; set; } = "";

    /// <summary>
    ///     User-supplied metadata the plugin never interprets; rides along for downstream consumers.
    /// </summary>
    [JsonProperty("metadata")]
    public Dictionary<string, string> Metadata { get; set; } = new();
}
