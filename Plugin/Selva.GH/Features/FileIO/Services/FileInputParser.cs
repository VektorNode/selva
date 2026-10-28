using System;
using System.Collections.Generic;
using System.Linq;
using Grasshopper.Kernel.Types;
using Newtonsoft.Json;
using Selva.FileIO;
using Selva.GH.Config;
using Selva.GH.Features.FileIO.Goos;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     Reads a file reference from a contextual or wired value: a <see cref="FileInputGoo" />, file
///     JSON (<c>{type, file, fileEnding}</c>), or a bare path.
/// </summary>
public static class FileInputParser
{
    private const int MaxFileDataSize = AppConfig.ValueLimits.MaxBase64StringLength;
    private const int MaxJsonDepth = AppConfig.JsonSerialization.MaxJsonDepth;
    private const int MaxPathLength = 32767; // Windows MAX_PATH ceiling.

    private static readonly string[] ValidTypes = { "path", "url", "base64" };

    public static FileInputData Parse(object item)
    {
        return item switch
        {
            null => null,
            FileInputGoo goo => goo.Value,
            FileInputData data => data,
            GH_String ghString => ParseString(ghString.Value),
            IGH_Goo goo => ParseString(goo.ScriptVariable()?.ToString()),
            string str => ParseString(str),
            _ => null
        };
    }

    /// <summary>Null when the file is acceptable, otherwise the reason it is not.</summary>
    public static string Validate(FileInputData fileData, IEnumerable<string> acceptedFormats)
    {
        if (fileData == null || string.IsNullOrWhiteSpace(fileData.File))
        {
            return "No file data provided";
        }

        if (fileData.File.Length > MaxFileDataSize)
        {
            return $"File data is too large: {fileData.File.Length} chars (max {MaxFileDataSize})";
        }

        if (fileData.Type != null && !ValidTypes.Contains(fileData.Type.ToLowerInvariant()))
        {
            return $"Unknown file reference type '{fileData.Type}'";
        }

        if (fileData.FileEnding != null && !acceptedFormats.Contains(fileData.FileEnding.ToLowerInvariant()))
        {
            return $"Unsupported file format '{fileData.FileEnding}'";
        }

        return null;
    }

    private static FileInputData ParseString(string str)
    {
        if (string.IsNullOrEmpty(str) || str.Length > MaxFileDataSize)
        {
            return null;
        }

        try
        {
            var settings = new JsonSerializerSettings
            {
                MaxDepth = MaxJsonDepth,
                TypeNameHandling = TypeNameHandling.None // prevent type injection attacks
            };

            var data = JsonConvert.DeserializeObject<FileInputData>(str, settings);
            if (data != null && !string.IsNullOrEmpty(data.File))
            {
                return data.Type == null || ValidTypes.Contains(data.Type.ToLowerInvariant()) ? data : null;
            }
        }
        catch (JsonException)
        {
            // Not JSON — treat as a path.
        }
        catch (Exception)
        {
            return null;
        }

        try
        {
            return str.Length > MaxPathLength ? null : FileInputData.FromPath(str);
        }
        catch
        {
            return null;
        }
    }
}
