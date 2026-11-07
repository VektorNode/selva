using System;
using System.IO;

namespace Selva.FileIO;

internal static class PathContainment
{
    /// <summary>
    ///     Both paths must already be full paths. Case-insensitive on Windows, case-sensitive on Unix,
    ///     matching the host filesystem.
    /// </summary>
    public static bool IsWithin(string baseDir, string candidate)
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
