using System;
using System.IO;
using Selva.GH.Features.FileIO.Services;

namespace Selva.Tests;

public class ServerFilePathTests
{
    private static readonly char Sep = Path.DirectorySeparatorChar;

    // A base directory that is absolute on whichever OS the test runs on.
    private static string BaseDir =>
        Sep == '\\' ? @"C:\srv\selva\data" : "/srv/selva/data";

    // ---- Happy path: separators are normalised to the host ----

    [Theory]
    [InlineData("bracket.3dm")]
    [InlineData("geometry/bracket.3dm")]   // forward slash (Linux-authored)
    [InlineData("geometry\\bracket.3dm")] // backslash (Windows-authored)
    public void Resolve_joins_relative_under_base(string relative)
    {
        var resolved = ServerFilePath.Resolve(BaseDir, relative);

        var expected = Path.GetFullPath(Path.Combine(BaseDir, "geometry", "bracket.3dm"));
        // Single-segment case resolves directly under base.
        if (!relative.Contains("geometry"))
        {
            expected = Path.GetFullPath(Path.Combine(BaseDir, "bracket.3dm"));
        }

        Assert.Equal(expected, resolved);
        Assert.StartsWith(Path.GetFullPath(BaseDir), resolved);
        Assert.DoesNotContain('/', resolved.Replace(Path.GetFullPath(BaseDir), ""));
    }

    [Fact]
    public void Resolve_trims_surrounding_whitespace()
    {
        var resolved = ServerFilePath.Resolve(BaseDir, "  bracket.3dm  ");
        Assert.Equal(Path.GetFullPath(Path.Combine(BaseDir, "bracket.3dm")), resolved);
    }

    // ---- Rejections ----

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void Resolve_rejects_empty_relative(string relative)
    {
        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(BaseDir, relative));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Resolve_rejects_empty_base(string baseDir)
    {
        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(baseDir, "bracket.3dm"));
    }

    [Fact]
    public void Resolve_rejects_path_traversal_out_of_base()
    {
        Assert.Throws<ArgumentException>(
            () => ServerFilePath.Resolve(BaseDir, "../../etc/passwd"));
    }

    [Fact]
    public void Resolve_allows_dotdot_that_stays_within_base()
    {
        // data/sub/../bracket.3dm collapses to data/bracket.3dm — still inside base.
        var resolved = ServerFilePath.Resolve(BaseDir, "sub/../bracket.3dm");
        Assert.Equal(Path.GetFullPath(Path.Combine(BaseDir, "bracket.3dm")), resolved);
    }

    [Fact]
    public void Resolve_rejects_rooted_relative_path()
    {
        var rooted = Sep == '\\' ? @"C:\secrets\key.3dm" : "/etc/passwd";
        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(BaseDir, rooted));
    }
}
