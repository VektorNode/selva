using System;
using System.IO;

namespace Selva.GH.Features.FileIO.Services;

/// <summary>
///     Resolves a file authored as a path relative to a server's data directory into an
///     absolute path on the host running the solve.
///
///     Rhino-free by design so it can be unit-tested without the Grasshopper runtime.
///
///     Cross-platform: a relative path authored with either separator ("a\b" or "a/b")
///     resolves correctly on both Windows and Linux, because every separator is normalised
///     to the host's <see cref="Path.DirectorySeparatorChar" /> before joining.
/// </summary>
public static class ServerFilePath
{
    /// <summary>
    ///     Joins <paramref name="basePath" /> (the server data directory) with
    ///     <paramref name="relativePath" /> and returns the absolute, normalised result.
    /// </summary>
    /// <exception cref="ArgumentException">
    ///     Thrown when either argument is empty, when the relative path is rooted/absolute,
    ///     or when it escapes the base directory (path traversal).
    /// </exception>
    public static string Resolve(string basePath, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(basePath))
        {
            throw new ArgumentException("Server data path is empty", nameof(basePath));
        }

        if (string.IsNullOrWhiteSpace(relativePath))
        {
            throw new ArgumentException("Relative path is empty", nameof(relativePath));
        }

        var normalizedRelative = NormalizeSeparators(relativePath.Trim());

        // Reject absolute/rooted relative paths (e.g. "/etc/passwd", "C:\secrets",
        // "\\server\share") — the whole point is that the base directory is the root.
        if (Path.IsPathRooted(normalizedRelative))
        {
            throw new ArgumentException(
                $"Relative path must not be absolute or rooted: '{relativePath}'", nameof(relativePath));
        }

        var normalizedBase = NormalizeSeparators(basePath.Trim());

        // Path.GetFullPath collapses any "." / ".." segments. Combine before resolving so
        // traversal that climbs out of the base ("../../etc/passwd") is caught below.
        var combined = Path.Combine(normalizedBase, normalizedRelative);
        var resolved = Path.GetFullPath(combined);
        var resolvedBase = Path.GetFullPath(normalizedBase);

        if (!IsWithinBase(resolvedBase, resolved))
        {
            throw new ArgumentException(
                $"Relative path escapes the server data directory: '{relativePath}'", nameof(relativePath));
        }

        return resolved;
    }

    /// <summary>
    ///     Replaces both '\' and '/' with the host directory separator so paths authored on
    ///     one OS resolve on the other.
    /// </summary>
    private static string NormalizeSeparators(string path)
    {
        return path
            .Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
    }

    /// <summary>
    ///     True when <paramref name="candidate" /> sits inside <paramref name="baseDir" />
    ///     (or equals it). Comparison is case-insensitive on Windows, case-sensitive on Unix,
    ///     matching the host filesystem.
    /// </summary>
    private static bool IsWithinBase(string baseDir, string candidate)
    {
        var withSeparator = baseDir.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
            ? baseDir
            : baseDir + Path.DirectorySeparatorChar;

        var comparison = Path.DirectorySeparatorChar == '\\'
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;

        return candidate.StartsWith(withSeparator, comparison)
               || string.Equals(candidate, baseDir, comparison);
    }
}
