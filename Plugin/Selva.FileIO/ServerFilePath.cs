using System;
using System.IO;
using System.Reflection;

namespace Selva.FileIO;

/// <summary>
///     Resolves a file authored as a path relative to a server's data directory into an
///     absolute path on the host running the solve. Rhino-free so it can be unit-tested
///     without the Grasshopper runtime.
/// </summary>
public static class ServerFilePath
{
    /// <summary>
    ///     Joins <paramref name="basePath" /> (the server data directory) with
    ///     <paramref name="relativePath" />. Accepts either '\' or '/' in
    ///     <paramref name="relativePath" /> so paths authored on one OS resolve on the other.
    /// </summary>
    /// <exception cref="ArgumentException">
    ///     Either argument is empty, the relative path is rooted/absolute, or it escapes the
    ///     base directory, by <c>..</c> or through a symbolic link.
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

        if (!PathContainment.IsWithin(resolvedBase, resolved) ||
            !PathContainment.IsWithin(ResolveLinks(resolvedBase), ResolveLinks(resolved)))
        {
            throw new ArgumentException(
                $"Relative path escapes the server data directory: '{relativePath}'", nameof(relativePath));
        }

        return resolved;
    }

    // netstandard2.0 has no link API, so it is looked up at run time: .NET 6 and later have
    // FileSystemInfo.LinkTarget. On .NET Framework it is missing and only the lexical check applies.
    private static readonly PropertyInfo LinkTargetProperty =
        typeof(FileSystemInfo).GetProperty("LinkTarget", typeof(string));

    // Linux gives up on a path after 40 links (ELOOP); a cycle must not recurse forever here.
    private const int MaxLinkHops = 40;

    /// <summary>
    ///     <paramref name="fullPath" /> with every symbolic link or junction on it replaced by its
    ///     target, component by component, so a link anywhere on the path counts. Components that
    ///     don't exist yet are kept as written.
    /// </summary>
    private static string ResolveLinks(string fullPath)
    {
        var hops = 0;
        return ResolveLinks(fullPath, ref hops);
    }

    private static string ResolveLinks(string fullPath, ref int hops)
    {
        if (LinkTargetProperty == null)
        {
            return fullPath;
        }

        var root = Path.GetPathRoot(fullPath) ?? "";
        var current = root;
        var segments = fullPath.Substring(root.Length)
            .Split(new[] { Path.DirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);

        foreach (var segment in segments)
        {
            var next = Path.Combine(current, segment);
            if (ReadLinkTarget(next) is string target)
            {
                if (++hops > MaxLinkHops)
                {
                    throw new ArgumentException($"Too many symbolic links resolving '{fullPath}'");
                }

                next = ResolveLinks(Path.GetFullPath(Path.Combine(current, target)), ref hops);
            }

            current = next;
        }

        return current;
    }

    private static string ReadLinkTarget(string path)
    {
        try
        {
            return (string)LinkTargetProperty.GetValue(new FileInfo(path));
        }
        catch (TargetInvocationException ex)
        {
            throw new ArgumentException($"Could not read '{path}': {ex.InnerException?.Message}", ex);
        }
    }

    private static string NormalizeSeparators(string path)
    {
        return path
            .Replace('\\', Path.DirectorySeparatorChar)
            .Replace('/', Path.DirectorySeparatorChar);
    }
}
