using Selva.FileIO;

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

    // "C:evil" is relative to drive C's working directory: Path.Combine rebases onto it.
    [Theory]
    [InlineData("C:evil/x")]
    [InlineData("ROOT::C:evil::x")]
    [InlineData("c:../x")]
    public void Split_DropsDriveRelativeSegments(string raw)
    {
        Assert.DoesNotContain(SubFolderPath.Split(raw), segment => segment.Contains(':'));
        Assert.Equal("x", SubFolderPath.Split(raw)[^1]);
    }

    // NTFS reads "name:stream" as an alternate data stream of "name".
    [Fact]
    public void Split_DropsSegmentsWithAColon()
    {
        Assert.Equal(["ROOT"], SubFolderPath.Split("ROOT/a:b"));
    }

    // One rule on every OS, so a definition bakes the same folders on macOS as on Windows.
    [Theory]
    [InlineData("a<b")]
    [InlineData("a>b")]
    [InlineData("a\"b")]
    [InlineData("a|b")]
    [InlineData("a?b")]
    [InlineData("a*b")]
    [InlineData("a\0b")]
    [InlineData("a\u001fb")]
    public void Split_DropsSegmentsWithCharactersWindowsForbids(string bad)
    {
        Assert.Equal(["ROOT", "ok"], SubFolderPath.Split("ROOT/" + bad + "/ok"));
    }

    // Windows opens the device for these, whatever the extension, so the write lands nowhere.
    [Theory]
    [InlineData("aux")]
    [InlineData("NUL")]
    [InlineData("nul.txt")]
    [InlineData("Con .txt")]
    [InlineData("COM1")]
    [InlineData("lpt9.log")]
    [InlineData("COM\u00B9")]
    public void Split_DropsWindowsDeviceNames(string device)
    {
        Assert.Equal(["ROOT", "ok"], SubFolderPath.Split("ROOT/" + device + "/ok"));
    }

    [Theory]
    [InlineData("console")]
    [InlineData("COM10")]
    [InlineData("auxiliary.txt")]
    public void Split_KeepsNamesThatOnlyStartLikeADevice(string name)
    {
        Assert.Equal(["ROOT", name], SubFolderPath.Split("ROOT/" + name));
    }

    // Windows trims the trailing dot, so "v1." would create "v1" and the write would miss it.
    [Fact]
    public void Split_DropsSegmentsWithATrailingDot()
    {
        Assert.Equal(["ROOT", "ok"], SubFolderPath.Split("ROOT/v1./ok"));
    }

    [Fact]
    public void Split_PureTraversal_YieldsNothing()
    {
        Assert.Empty(SubFolderPath.Split("../../.."));
    }
}
