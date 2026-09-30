using System;
using System.IO;

namespace Selva.Tests;

internal static class TestPaths
{
    /// <summary>The directory holding pnpm-workspace.yaml, found by walking up from the test binaries.</summary>
    public static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException(
            "Could not locate repo root (pnpm-workspace.yaml) from " + AppContext.BaseDirectory);
    }
}
