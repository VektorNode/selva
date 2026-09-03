using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     Splits a <c>Sub Folder</c> value into folder segments.
///
///     <c>::</c> nests, matching Rhino's layer separator: <c>ROOT::Panels</c> is two levels. Plain
///     values stay single-level, so <c>Panels</c> means what it always did. <c>/</c> and <c>\</c>
///     are accepted as separators too: people type them out of habit, and before this they
///     produced a real folder on one output path and a broken name on the other.
///
///     Segments are also the zip-slip defense for the disk path: <c>.</c>, <c>..</c> and
///     drive-letter segments are dropped so a file can never be written outside the export root.
///     (The web path re-sanitizes on arrival: the client can't trust a server-supplied path
///     regardless of what wrote it.)
/// </summary>
public static class SubFolderPath
{
    private static readonly char[] SegmentSeparators = { '/', '\\' };

    /// <summary>Folder segments, outermost first. Empty when nothing usable remains.</summary>
    public static IReadOnlyList<string> Split(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Array.Empty<string>();
        }

        return raw
            .Replace("::", "/")
            .Split(SegmentSeparators, StringSplitOptions.RemoveEmptyEntries)
            .Select(segment => segment.Trim())
            .Where(IsUsable)
            .ToList();
    }

    /// <summary>Forward-slash joined form, for the wire and for zip entry paths.</summary>
    public static string ToArchivePath(string raw)
    {
        return string.Join("/", Split(raw));
    }

    private static bool IsUsable(string segment)
    {
        if (segment.Length == 0 || segment == "." || segment == "..")
        {
            return false;
        }

        // A bare drive letter ("C:") would otherwise rebase the whole path on the disk export.
        return !(segment.Length == 2 && segment[1] == ':' && char.IsLetter(segment[0]));
    }
}
