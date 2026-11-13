using System;
using System.IO;
using Newtonsoft.Json;

namespace Selva.FileIO;

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

    /// <summary>
    ///     Null when a solve request may name this file, otherwise why not. On Compute a path
    ///     (type "path", or no type) is opened with the server's rights by whoever can solve,
    ///     share-link visitors included: a file on its disk, or a UNC share that then receives
    ///     the server's credentials. A request names only data it sends or a URL. Paths the
    ///     definition's author wired in do not come through here.
    /// </summary>
    public string ProblemAsRequestInput(bool onCompute)
    {
        if (!onCompute)
        {
            return null;
        }

        var type = Type?.ToLowerInvariant();
        return type == "base64" || type == "url"
            ? null
            : "A file path is not accepted in a solve request. Upload the file or pass a URL.";
    }

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
