using System;
using System.IO;
using Newtonsoft.Json;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     File input from the web UI or a local source: a local path, a URL, or base64-encoded data.
/// </summary>
public class FileInputData
{
    [JsonProperty("file")]
    public string File { get; set; }

    /// <summary>"path", "url", or "base64".</summary>
    [JsonProperty("type")]
    public string Type { get; set; }

    /// <summary>File extension (e.g. ".step", ".3dm"); required for base64 mode.</summary>
    [JsonProperty("fileEnding")]
    public string FileEnding { get; set; }

    public static FileInputData FromPath(string path)
    {
        return new FileInputData
        {
            File = path,
            Type = "path",
            FileEnding = Path.GetExtension(path)
        };
    }

    public static FileInputData FromUrl(string url)
    {
        var extension = Path.GetExtension(new Uri(url).LocalPath);
        return new FileInputData
        {
            File = url,
            Type = "url",
            FileEnding = extension
        };
    }

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
