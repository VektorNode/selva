using Selva.FileIO;

namespace Selva.Tests;

public sealed class BakeFilePathTests
{
    private static readonly string Base = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "selva-bake"));

    private static FileData File(string? name, string? type = ".txt", string subFolder = "")
    {
        return new FileData { FileName = name!, FileType = type!, SubFolder = subFolder };
    }

    private static string Under(params string[] segments)
    {
        return Path.Combine(new[] { Base }.Concat(segments).ToArray());
    }

    [Fact]
    public void Resolve_PutsTheFileInItsSubFolder()
    {
        Assert.Equal(Under("ROOT", "Panels", "part.3dm"),
            BakeFilePath.Resolve(Base, File("part", ".3dm", "ROOT::Panels")));
    }

    [Theory]
    [InlineData(null, ".txt", "file.txt")]
    [InlineData("part", null, "part.bin")]
    [InlineData("part", "3dm", "part.3dm")]
    public void Resolve_FillsInAMissingNameOrDot(string? name, string? type, string expected)
    {
        Assert.Equal(Under(expected), BakeFilePath.Resolve(Base, File(name, type)));
    }

    [Theory]
    [InlineData("../../x")]
    [InlineData("..\\..\\x")]
    [InlineData("/x")]
    public void Resolve_KeepsATraversingFileNameUnderTheBase(string name)
    {
        var path = Path.GetFullPath(BakeFilePath.Resolve(Base, File(name)));

        Assert.StartsWith(Base + Path.DirectorySeparatorChar, path);
        Assert.Equal("x.txt", Path.GetFileName(path));
    }

    [Fact]
    public void Resolve_KeepsATraversingFileTypeUnderTheBase()
    {
        var path = Path.GetFullPath(BakeFilePath.Resolve(Base, File("part", "/../../evil")));

        Assert.StartsWith(Base + Path.DirectorySeparatorChar, path);
    }

    [Fact]
    public void Resolve_DropsADriveRelativeSubFolder()
    {
        Assert.Equal(Under("x", "part.txt"), BakeFilePath.Resolve(Base, File("part", ".txt", "C:evil/x")));
    }

    [Fact]
    public void Resolve_NestsAFileNameWithSlashesTheWayTheWebArchiveDoes()
    {
        Assert.Equal(Under("reports", "summary.pdf"), BakeFilePath.Resolve(Base, File("reports/summary", ".pdf")));
    }

    [Theory]
    [InlineData("..")]
    [InlineData("C:")]
    [InlineData("C:x")]
    [InlineData("a:b")]
    public void Resolve_RefusesANameWithNothingUsableLeft(string name)
    {
        Assert.Throws<ArgumentException>(() => BakeFilePath.Resolve(Base, File(name, "")));
    }

    // Dropping the last segment would write the file under its folder's name, with no extension.
    [Theory]
    [InlineData("exports/plan:v2", "pdf")]
    [InlineData("exports/nul", "txt")]
    [InlineData("exports/", "")]
    public void Resolve_RefusesAnUnusableLastSegmentInsteadOfPromotingItsFolder(string name, string type)
    {
        Assert.Throws<ArgumentException>(() => BakeFilePath.Resolve(Base, File(name, type)));
    }

    [Fact]
    public void Resolve_AnEmptyFileTypeAddsNoExtension()
    {
        Assert.Equal(Under("part"), BakeFilePath.Resolve(Base, File("part", "")));
    }
}
