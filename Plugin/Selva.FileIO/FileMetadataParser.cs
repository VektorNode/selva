using System;
using System.Collections.Generic;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     Parses "key=value" text lines into a metadata dictionary attached to <see cref="FileData" />.
///     Shared by every component that produces file output so the input format stays consistent.
/// </summary>
public static class FileMetadataParser
{
    /// <summary>
    ///     Parses a list of "key=value" lines into a dictionary. Blank lines are ignored, keys are
    ///     trimmed, and the first '=' separates key from value (values may themselves contain '=').
    ///     Later entries overwrite earlier ones with the same key.
    /// </summary>
    public static Dictionary<string, string> Parse(IEnumerable<string> lines)
    {
        var metadata = new Dictionary<string, string>();
        if (lines == null)
        {
            return metadata;
        }

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            var separatorIndex = line.IndexOf('=');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var key = line.Substring(0, separatorIndex).Trim();
            var value = line.Substring(separatorIndex + 1).Trim();

            if (key.Length > 0)
            {
                metadata[key] = value;
            }
        }

        return metadata;
    }
}
