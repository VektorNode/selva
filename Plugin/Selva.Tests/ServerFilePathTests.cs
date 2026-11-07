using System;
using System.IO;
using Selva.FileIO;

namespace Selva.Tests;

public class ServerFilePathTests
{
    private static readonly char Sep = Path.DirectorySeparatorChar;

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
        if (!relative.Contains("geometry"))
        {
            expected = Path.GetFullPath(Path.Combine(BaseDir, "bracket.3dm"));
        }

        Assert.Equal(expected, resolved);
        Assert.StartsWith(Path.GetFullPath(BaseDir), resolved);

        // Every separator was normalised to the host's. Assert the *foreign* separator is
        // gone rather than a hard-coded '/': on Unix '/' IS the host separator, so checking
        // for it would fail on a correctly-resolved path.
        var foreignSeparator = Sep == '\\' ? '/' : '\\';
        Assert.DoesNotContain(foreignSeparator, resolved.Replace(Path.GetFullPath(BaseDir), ""));
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

    // "/srv/selva/data-evil" starts with "/srv/selva/data": a prefix test without the separator
    // lets a sibling directory through.
    [Fact]
    public void Resolve_rejects_a_sibling_directory_sharing_the_base_prefix()
    {
        Assert.Throws<ArgumentException>(
            () => ServerFilePath.Resolve(BaseDir, "../data-evil/x.3dm"));
    }

    [Fact]
    public void Resolve_allows_dotdot_that_stays_within_base()
    {
        // sub/../bracket.3dm collapses to bracket.3dm — still inside base.
        var resolved = ServerFilePath.Resolve(BaseDir, "sub/../bracket.3dm");
        Assert.Equal(Path.GetFullPath(Path.Combine(BaseDir, "bracket.3dm")), resolved);
    }

    [Fact]
    public void Resolve_rejects_rooted_relative_path()
    {
        var rooted = Sep == '\\' ? @"C:\secrets\key.3dm" : "/etc/passwd";
        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(BaseDir, rooted));
    }

    // ---- Symbolic links: Path.GetFullPath is lexical, so a link inside the data directory
    //      can point anywhere ----

    [SymlinkFact]
    public void Resolve_rejects_a_directory_link_that_leaves_the_base()
    {
        using var tree = new LinkTree();
        Directory.CreateSymbolicLink(Path.Combine(tree.Data, "linked"), tree.Outside);

        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(tree.Data, "linked/secret.3dm"));
    }

    [SymlinkFact]
    public void Resolve_rejects_a_file_link_that_leaves_the_base()
    {
        using var tree = new LinkTree();
        File.CreateSymbolicLink(Path.Combine(tree.Data, "secret.3dm"), Path.Combine(tree.Outside, "secret.3dm"));

        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(tree.Data, "secret.3dm"));
    }

    [SymlinkFact]
    public void Resolve_rejects_a_link_whose_relative_target_climbs_out()
    {
        using var tree = new LinkTree();
        Directory.CreateSymbolicLink(Path.Combine(tree.Data, "up"), Path.Combine("..", "outside"));

        Assert.Throws<ArgumentException>(() => ServerFilePath.Resolve(tree.Data, "up/secret.3dm"));
    }

    [SymlinkFact]
    public void Resolve_allows_a_link_that_stays_inside_the_base()
    {
        using var tree = new LinkTree();
        Directory.CreateDirectory(Path.Combine(tree.Data, "real"));
        Directory.CreateSymbolicLink(Path.Combine(tree.Data, "alias"), Path.Combine(tree.Data, "real"));

        var resolved = ServerFilePath.Resolve(tree.Data, "alias/part.3dm");

        Assert.Equal(Path.Combine(tree.Data, "alias", "part.3dm"), resolved);
    }

    // A base reached through a link (macOS temp lives under /var -> /private/var) is still the base.
    [SymlinkFact]
    public void Resolve_allows_a_base_that_is_itself_a_link()
    {
        using var tree = new LinkTree();
        var baseLink = Path.Combine(tree.Root, "data-link");
        Directory.CreateSymbolicLink(baseLink, tree.Data);

        var resolved = ServerFilePath.Resolve(baseLink, "part.3dm");

        Assert.Equal(Path.Combine(baseLink, "part.3dm"), resolved);
    }

    /// <summary>root/data is the server data directory; root/outside holds a file it must not reach.</summary>
    private sealed class LinkTree : IDisposable
    {
        public LinkTree()
        {
            Root = Path.Combine(Path.GetTempPath(), "selva-server-path-" + Guid.NewGuid());
            Data = Path.Combine(Root, "data");
            Outside = Path.Combine(Root, "outside");
            Directory.CreateDirectory(Data);
            Directory.CreateDirectory(Outside);
            File.WriteAllText(Path.Combine(Outside, "secret.3dm"), "secret");
        }

        public string Root { get; }
        public string Data { get; }
        public string Outside { get; }

        public void Dispose()
        {
            // Delete links first so the recursive delete never follows one out of the tree.
            foreach (var entry in Directory.EnumerateFileSystemEntries(Root, "*", SearchOption.AllDirectories)
                         .Where(e => new FileInfo(e).LinkTarget != null)
                         .ToList())
            {
                if (Directory.Exists(entry))
                {
                    Directory.Delete(entry);
                }
                else
                {
                    File.Delete(entry);
                }
            }

            Directory.Delete(Root, true);
        }
    }
}
