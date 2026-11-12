using System.IO.Compression;
using System.Text;
using Selva.Setup;

namespace Selva.Tests;

public sealed class SetupPayloadTests : IDisposable
{
    private readonly string _selvaFolder =
        Path.Combine(Path.GetTempPath(), "selva-setup-tests", Guid.NewGuid().ToString("N"), "Selva");

    public void Dispose()
    {
        var root = Path.GetDirectoryName(_selvaFolder)!;
        if (Directory.Exists(root))
        {
            Directory.Delete(root, true);
        }
    }

    private static MemoryStream Package(params (string Name, string Content)[] entries)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, true))
        {
            foreach (var (name, content) in entries)
            {
                using var writer = new StreamWriter(archive.CreateEntry(name).Open(), Encoding.UTF8);
                writer.Write(content);
            }
        }

        stream.Position = 0;
        return stream;
    }

    private static MemoryStream SelvaPackage(string version)
    {
        return Package(
            ("manifest.yml", $"---\nname: Selva\nversion: {version}\nauthors:\n  - Someone\n"),
            ("Selva.gha", "plug-in"),
            ("app/SelvaApp.exe", "app"));
    }

    [Theory]
    [InlineData("0.25.0")]
    [InlineData("0.26.0-beta.3")]
    public void The_version_comes_from_the_package_manifest(string version)
    {
        Assert.Equal(version, PackagePayload.ReadVersion(SelvaPackage(version)));
    }

    [Fact]
    public void A_package_without_a_manifest_has_no_version()
    {
        Assert.Null(PackagePayload.ReadVersion(Package(("Selva.gha", "plug-in"))));
    }

    [Fact]
    public void Installing_unpacks_the_version_folder_and_points_rhino_at_it()
    {
        PackagePayload.Install(SelvaPackage("0.25.0"), _selvaFolder, "0.25.0");

        Assert.Equal("plug-in", File.ReadAllText(Path.Combine(_selvaFolder, "0.25.0", "Selva.gha")));
        Assert.Equal("app", File.ReadAllText(Path.Combine(_selvaFolder, "0.25.0", "app", "SelvaApp.exe")));
        Assert.Equal("0.25.0", File.ReadAllText(Path.Combine(_selvaFolder, "manifest.txt")));
    }

    [Fact]
    public void Installing_replaces_the_same_version_and_removes_older_ones()
    {
        PackagePayload.Install(SelvaPackage("0.24.0"), _selvaFolder, "0.24.0");
        PackagePayload.Install(SelvaPackage("0.25.0"), _selvaFolder, "0.25.0");
        File.WriteAllText(Path.Combine(_selvaFolder, "0.25.0", "left-over.txt"), "from the last install");

        PackagePayload.Install(SelvaPackage("0.25.0"), _selvaFolder, "0.25.0");

        Assert.Equal(new[] { "0.25.0" }, Directory.GetDirectories(_selvaFolder).Select(Path.GetFileName));
        Assert.False(File.Exists(Path.Combine(_selvaFolder, "0.25.0", "left-over.txt")));
        Assert.Equal("0.25.0", File.ReadAllText(Path.Combine(_selvaFolder, "manifest.txt")));
    }

    [Fact]
    public void A_package_that_writes_outside_its_folder_is_refused_and_leaves_the_install_alone()
    {
        PackagePayload.Install(SelvaPackage("0.25.0"), _selvaFolder, "0.25.0");
        var hostile = Package(("manifest.yml", "version: 0.26.0\n"), ("../../escaped.txt", "out"));

        Assert.Throws<InvalidDataException>(() => PackagePayload.Install(hostile, _selvaFolder, "0.26.0"));

        Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(_selvaFolder)!, "escaped.txt")));
        Assert.Equal(new[] { "0.25.0" }, Directory.GetDirectories(_selvaFolder).Select(Path.GetFileName));
        Assert.Equal("0.25.0", File.ReadAllText(Path.Combine(_selvaFolder, "manifest.txt")));
    }
}
