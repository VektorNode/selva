using System;
using System.IO;

namespace Selva.Slva.Tests;

/// <summary>
///     Locates the shared codec fixtures in <c>packages/schemas/fixtures/</c>. They live in the
///     web workspace, not this test project, because the TS parser tests decode the same committed
///     bytes — the fixtures are the cross-stack contract and cannot move.
/// </summary>
internal static class FixtureLocator
{
    /// <summary>Absolute path of a fixtures subdirectory, e.g. <c>Dir("slva", "v3")</c>.</summary>
    public static string Dir(params string[] segments)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
        {
            dir = dir.Parent;
        }

        if (dir == null)
        {
            throw new DirectoryNotFoundException(
                "Could not locate repo root (pnpm-workspace.yaml) from " + AppContext.BaseDirectory);
        }

        var path = Path.Combine(dir.FullName, "packages", "schemas", "fixtures");
        foreach (var segment in segments)
        {
            path = Path.Combine(path, segment);
        }

        return path;
    }
}
