using Selva.GH.Features.FileIO.Services;

namespace Selva.Tests;

/// <summary>
///     Tests for SubFolderPath — how a <c>Sub Folder</c> value becomes folder segments.
///
///     Two latent bugs motivated this. A value like "ROOT::Panels" was passed to
///     Directory.CreateDirectory unchanged, which throws IOException on Windows because ':' is
///     illegal in a directory name; on the web path the same value became a literal folder named
///     "ROOT::Panels". Neither did what anyone typing it would expect.
/// </summary>
public class SubFolderPathTests
{
    // -------------------------------------------------------------------------
    // Existing values keep working
    // -------------------------------------------------------------------------

    [Fact]
    public void Split_SingleSegment_IsUnchanged()
    {
        Assert.Equal(["Panels"], SubFolderPath.Split("Panels"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Split_Blank_YieldsNothing(string? raw)
    {
        Assert.Empty(SubFolderPath.Split(raw!));
    }

    [Fact]
    public void ToArchivePath_SingleSegment_IsUnchanged()
    {
        Assert.Equal("Panels", SubFolderPath.ToArchivePath("Panels"));
    }

    // -------------------------------------------------------------------------
    // :: nests, following the Rhino layer separator
    // -------------------------------------------------------------------------

    [Fact]
    public void Split_DoubleColon_Nests()
    {
        Assert.Equal(["ROOT", "Panels"], SubFolderPath.Split("ROOT::Panels"));
    }

    [Fact]
    public void Split_NestsArbitrarilyDeep()
    {
        Assert.Equal(["ROOT", "First", "Second"], SubFolderPath.Split("ROOT::First::Second"));
    }

    [Fact]
    public void ToArchivePath_DoubleColon_BecomesSlashes()
    {
        Assert.Equal("ROOT/Panels", SubFolderPath.ToArchivePath("ROOT::Panels"));
    }

    [Fact]
    public void Split_DistinctRoots_StayDistinct()
    {
        // Two components feeding one Context Bake: different roots must not merge.
        Assert.Equal("ROOT/Sub", SubFolderPath.ToArchivePath("ROOT::Sub"));
        Assert.Equal("OTHERROOT/Sub", SubFolderPath.ToArchivePath("OTHERROOT::Sub"));
    }

    [Fact]
    public void Split_TrimsSegmentWhitespace()
    {
        Assert.Equal(["ROOT", "Second Layer"], SubFolderPath.Split("ROOT :: Second Layer "));
    }

    [Theory]
    [InlineData("ROOT::")]
    [InlineData("::ROOT")]
    [InlineData("ROOT::::Sub")]
    public void Split_IgnoresEmptySegments(string raw)
    {
        Assert.DoesNotContain("", SubFolderPath.Split(raw));
    }

    // -------------------------------------------------------------------------
    // Slashes are accepted too — people type them out of habit
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("ROOT/Panels")]
    [InlineData("ROOT\\Panels")]
    [InlineData("ROOT::Panels")]
    public void Split_SeparatorsAreEquivalent(string raw)
    {
        Assert.Equal(["ROOT", "Panels"], SubFolderPath.Split(raw));
    }

    [Fact]
    public void Split_MixedSeparators_Normalize()
    {
        Assert.Equal(["A", "B", "C"], SubFolderPath.Split("A::B/C"));
    }

    // -------------------------------------------------------------------------
    // Traversal defense — a Sub Folder must not escape the export root
    // -------------------------------------------------------------------------

    [Fact]
    public void Split_DropsTraversalSegments()
    {
        Assert.Equal(["ROOT", "evil"], SubFolderPath.Split("ROOT::..::evil"));
    }

    [Fact]
    public void Split_DropsCurrentDirectorySegments()
    {
        Assert.Equal(["ROOT"], SubFolderPath.Split("./ROOT/."));
    }

    [Fact]
    public void Split_DropsDriveLetters()
    {
        // Otherwise Path.Combine would rebase onto the drive root and write outside the export.
        Assert.Equal(["Windows"], SubFolderPath.Split("C:/Windows"));
    }

    [Fact]
    public void Split_PureTraversal_YieldsNothing()
    {
        Assert.Empty(SubFolderPath.Split("../../.."));
    }
}
