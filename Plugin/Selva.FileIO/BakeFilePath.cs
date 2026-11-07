using System;
using System.IO;
using System.Linq;

namespace Selva.FileIO;

/// <summary>
///     Where Bake Files writes a <see cref="FileData" /> under the folder the user chose. The name
///     and extension go through the same segment rules as the sub folder, so a name like
///     <c>../../x</c> lands inside the base and <c>reports/summary</c> nests the way the web archive
///     nests it. The last segment is checked on its own: dropping it would promote a folder
///     segment to the file name.
/// </summary>
public static class BakeFilePath
{
    private static readonly char[] NameSeparators = { '/', '\\' };

    /// <exception cref="ArgumentException">
    ///     The file name's last segment is unusable, or the result would still fall outside
    ///     <paramref name="basePath" />.
    /// </exception>
    public static string Resolve(string basePath, FileData file)
    {
        var root = Path.GetFullPath(basePath);

        var extension = file.FileType ?? ".bin";
        if (extension.Length > 0 && !extension.StartsWith(".", StringComparison.Ordinal))
        {
            extension = "." + extension;
        }

        var rawName = ((file.FileName ?? "file") + extension).Replace("::", "/");
        var cut = rawName.LastIndexOfAny(NameSeparators);
        var fileName = rawName.Substring(cut + 1).Trim();
        if (!SubFolderPath.IsUsable(fileName))
        {
            throw new ArgumentException($"File name '{rawName}' is not usable as a file name.");
        }

        var segments = new[] { root }
            .Concat(SubFolderPath.Split(file.SubFolder))
            .Concat(SubFolderPath.Split(rawName.Substring(0, cut + 1)))
            .Append(fileName);
        var path = Path.GetFullPath(Path.Combine(segments.ToArray()));
        if (!PathContainment.IsWithin(root, path))
        {
            throw new ArgumentException($"'{rawName}' would be written outside '{root}'.");
        }

        return path;
    }
}
