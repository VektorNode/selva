using System;
using System.Collections.Generic;
using System.Linq;

namespace Selva.FileIO;

/// <summary>
///     Splits a <c>Sub Folder</c> value into folder segments.
///
///     <c>::</c> nests, matching Rhino's layer separator: <c>ROOT::Panels</c> is two levels. Plain
///     values stay single-level, so <c>Panels</c> means what it always did. <c>/</c> and <c>\</c>
///     are accepted as separators too — people type them out of habit, and before this they
///     produced a real folder on one output path and a broken name on the other.
///
///     Segments are also the zip-slip defense for the disk path: <c>.</c>, <c>..</c> and any
///     segment Windows can't hold as a folder name are dropped, so a file can never be written
///     outside the export root. A colon is the dangerous one: <c>C:evil</c> is relative to drive
///     C's working directory, and <c>a:b</c> is an NTFS alternate data stream. A device name
///     (<c>NUL</c>, <c>aux.txt</c>) opens the device instead of a file, and a trailing dot is
///     trimmed by Windows, so <c>v1.</c> names a different folder. The same rule holds
///     on every OS, so a definition bakes the same folders on macOS as on Windows. (The web path
///     re-sanitizes on arrival — the client can't trust a server-supplied path regardless of what
///     wrote it.)
/// </summary>
public static class SubFolderPath
{
    private static readonly char[] SegmentSeparators = { '/', '\\' };

    private static readonly char[] ForbiddenChars = { ':', '<', '>', '"', '|', '?', '*' };

    private static readonly HashSet<string> DeviceNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "COM\u00B9", "COM\u00B2", "COM\u00B3",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "LPT\u00B9", "LPT\u00B2", "LPT\u00B3",
    };

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

    /// <summary>Whether a single trimmed segment can be a file or folder name on every OS.</summary>
    public static bool IsUsable(string segment)
    {
        return segment.Length > 0
               && !segment.EndsWith(".", StringComparison.Ordinal)
               && segment.IndexOfAny(ForbiddenChars) < 0
               && !segment.Any(char.IsControl)
               && !IsDeviceName(segment);
    }

    // Windows matches the device on the name before the first dot, ignoring trailing spaces.
    private static bool IsDeviceName(string segment)
    {
        var dot = segment.IndexOf('.');
        var stem = (dot < 0 ? segment : segment.Substring(0, dot)).TrimEnd();
        return DeviceNames.Contains(stem);
    }
}
