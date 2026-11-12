#nullable enable
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.RegularExpressions;

namespace Selva.Setup;

/// <summary>
///     Unpacks a Yak package (a zip) where Rhino's package manager would put it, so Rhino and the
///     package manager both see a normal install that the package manager can update later.
/// </summary>
internal static class PackagePayload
{
    private const string ManifestName = "manifest.yml";

    /// <summary>The package manager's pointer to the version Rhino loads.</summary>
    private const string VersionPointer = "manifest.txt";

    /// <returns>The version the package's manifest states, or null when it has none.</returns>
    public static string? ReadVersion(Stream yak)
    {
        using var archive = new ZipArchive(yak, ZipArchiveMode.Read, true);
        var manifest = archive.GetEntry(ManifestName);
        if (manifest == null)
        {
            return null;
        }

        using var reader = new StreamReader(manifest.Open());
        var match = Regex.Match(reader.ReadToEnd(), @"^version:\s*['""]?([0-9A-Za-z.+-]+)['""]?\s*$",
            RegexOptions.Multiline);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>
    ///     Installs the package as <paramref name="version" /> under <paramref name="selvaFolder" />
    ///     and makes it the one Rhino loads. Other versions there are removed, as the package
    ///     manager does on an update.
    /// </summary>
    /// <exception cref="IOException">A file of the same version is in use: Rhino or the Selva app is running.</exception>
    public static void Install(Stream yak, string selvaFolder, string version)
    {
        var target = Path.Combine(selvaFolder, version);

        // Unpacked beside its final place and swapped in by renaming, so a failure halfway leaves
        // the old install working. Windows refuses to rename a folder while a file in it is
        // open, where deleting it would remove every file up to the locked one.
        var staging = target + ".installing";
        var retired = target + ".removing";
        DeleteFolder(staging);
        Directory.CreateDirectory(staging);
        try
        {
            using (var archive = new ZipArchive(yak, ZipArchiveMode.Read, true))
            {
                Extract(archive, staging);
            }

            DeleteFolder(retired);
            if (Directory.Exists(target))
            {
                Directory.Move(target, retired);
            }

            try
            {
                Directory.Move(staging, target);
            }
            catch
            {
                if (Directory.Exists(retired) && !Directory.Exists(target))
                {
                    Directory.Move(retired, target);
                }

                throw;
            }
        }
        catch
        {
            DeleteFolder(staging);
            throw;
        }

        // Before the old versions go: if one of them can't be removed, Rhino still loads this one.
        File.WriteAllText(Path.Combine(selvaFolder, VersionPointer), version);

        foreach (var other in Directory.GetDirectories(selvaFolder)
                     .Where(folder => !string.Equals(Path.GetFileName(folder), version, StringComparison.OrdinalIgnoreCase)))
        {
            try
            {
                DeleteFolder(other);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                // Something still runs from it. Rhino ignores a folder the pointer doesn't name,
                // and the next install removes it.
            }
        }
    }

    private static void Extract(ZipArchive archive, string folder)
    {
        var root = Path.GetFullPath(folder) + Path.DirectorySeparatorChar;
        foreach (var entry in archive.Entries)
        {
            // An entry named "../x" would otherwise be written outside the package folder.
            var path = Path.GetFullPath(Path.Combine(folder, entry.FullName));
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("The package holds a file outside its own folder.");
            }

            if (entry.FullName.EndsWith("/", StringComparison.Ordinal) ||
                entry.FullName.EndsWith("\\", StringComparison.Ordinal))
            {
                Directory.CreateDirectory(path);
                continue;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            using var source = entry.Open();
            using var destination = File.Create(path);
            source.CopyTo(destination);
        }
    }

    public static void DeleteFolder(string folder)
    {
        if (Directory.Exists(folder))
        {
            Directory.Delete(folder, true);
        }
    }
}
