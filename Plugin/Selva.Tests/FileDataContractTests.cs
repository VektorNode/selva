using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Selva.FileIO;
using Xunit;

namespace Selva.Tests;

/// <summary>
///     Pins every serialized form of <see cref="FileData" /> against a committed fixture, so
///     extracting the type into a shared assembly cannot silently change a wire format.
///
///     Three paths exist and they do NOT agree, which is the reason this file is worth having:
///
///     <list type="bullet">
///         <item><c>ToComputeJson</c> — Rhino.Compute payload, governed by [JsonProperty].</item>
///         <item><c>Write</c>/<c>Read</c> — GH_IO, governed by [JsonProperty]. This one lands in
///         SAVED .gh files, so a renamed property orphans data already on disk.</item>
///         <item><c>ValueCollector.ExtractFileDataFromGoo</c> — the UI payload, hand-built from the
///         properties and NOT governed by the attributes. It already differs: it normalizes
///         subFolder through SubFolderPath and drops Id.</item>
///     </list>
///
///     Regenerate after an intentional shape change:
///     UPDATE_FILEDATA_FIXTURES=1 dotnet test --filter FileDataContractTests
/// </summary>
public class FileDataContractTests
{
    // Fixed identity: fixtures must be byte-stable across runs.
    private static readonly Guid FixedId = Guid.Parse("44444444-4444-4444-8444-444444444444");

    private static FileData Sample()
    {
        return new FileData
        {
            Id = FixedId,
            FileName = "export_example",
            Data = "PD94bWwgdmVyc2lvbj0iMS4wIj8+",
            FileType = ".xml",
            IsBase64Encoded = true,
            SubFolder = "ROOT::Panels",
            Metadata = new Dictionary<string, string> { ["author"] = "felix", ["job"] = "dst" }
        };
    }

    /// <summary>
    ///     A file carrying none of the optional parts. The defaults are part of the contract — an
    ///     empty SubFolder must stay "" rather than null, because the client concatenates it.
    /// </summary>
    private static FileData Minimal()
    {
        return new FileData
        {
            Id = FixedId,
            FileName = "report",
            Data = "hello",
            FileType = ".txt",
            IsBase64Encoded = false
        };
    }

    private static IEnumerable<(string FileName, FileData Value)> Samples()
    {
        yield return ("file-data-full.json", Sample());
        yield return ("file-data-minimal.json", Minimal());
    }

    /// <summary>
    ///     What <c>FileDataGoo.ToComputeJson</c> and <c>Write</c> both put on the wire.
    ///
    ///     <para>Serialized here directly rather than through the Goo: the Goo needs IGH_Goo, and
    ///     this project links Rhino-free sources instead of referencing Selva.GH (see its .csproj).
    ///     Both Goo methods call <c>JsonConvert.SerializeObject(Value)</c> with default settings, so
    ///     these are the same bytes — <see cref="TheGooAddsNothingToTheSerializedForm" /> is what
    ///     holds that equivalence, and it is the assumption to re-check if this ever disagrees with
    ///     production.</para>
    /// </summary>
    [Fact]
    public void SerializedJson_MatchesTheCommittedFixture()
    {
        AssertFixtures("compute", value => JsonConvert.SerializeObject(value));
    }

    /// <summary>
    ///     Guards the shortcut above: if either Goo method stops being a bare
    ///     <c>JsonConvert.SerializeObject(Value)</c> — gaining settings, a wrapper, a computed field
    ///     — the fixtures stop describing production and this must be revisited.
    /// </summary>
    [Fact]
    public void TheGooAddsNothingToTheSerializedForm()
    {
        var goo = File.ReadAllText(Path.Combine(
            FindRepoRoot(), "Plugin", "Selva.GH", "Features", "FileIO", "Goos", "FileDataGoo.cs"));

        Assert.True(goo.Contains("return JsonConvert.SerializeObject(Value);"),
            "ToComputeJson no longer serializes Value with default settings — the committed "
            + "fixtures were produced that way and no longer describe the compute payload.");

        Assert.True(goo.Contains("var json = JsonConvert.SerializeObject(Value);"),
            "Write/Duplicate no longer serialize Value with default settings — the committed "
            + "fixtures no longer describe what a saved .gh file holds.");
    }

    /// <summary>
    ///     Every public property is covered by the fixture. Adding one without a fixture entry fails
    ///     here, so the pinned shape cannot silently lag the type.
    /// </summary>
    [Fact]
    public void EveryPropertyIsPinned()
    {
        var fixturePath = Path.Combine(FixturesDir(), "compute", "file-data-full.json");
        Assert.True(File.Exists(fixturePath),
            "missing — run UPDATE_FILEDATA_FIXTURES=1 dotnet test --filter FileDataContractTests");

        var pinned = new HashSet<string>(
            JObject.Parse(File.ReadAllText(fixturePath)).Properties().Select(p => p.Name),
            StringComparer.Ordinal);

        var missing = typeof(FileData)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.GetCustomAttribute<JsonPropertyAttribute>()?.PropertyName ?? p.Name)
            .Where(name => !pinned.Contains(name))
            .ToList();

        Assert.True(missing.Count == 0,
            $"FileData properties absent from the fixture: {string.Join(", ", missing)}");
    }

    /// <summary>
    ///     A round trip must survive: this is what Read does to a saved definition, so a property the
    ///     serializer cannot restore is data loss on open, not a formatting difference.
    /// </summary>
    [Fact]
    public void RoundTripPreservesEveryField()
    {
        FileData original = Sample();
        var restored = JsonConvert.DeserializeObject<FileData>(JsonConvert.SerializeObject(original));

        Assert.Equal(original.Id, restored.Id);
        Assert.Equal(original.FileName, restored.FileName);
        Assert.Equal(original.Data, restored.Data);
        Assert.Equal(original.FileType, restored.FileType);
        Assert.Equal(original.IsBase64Encoded, restored.IsBase64Encoded);
        Assert.Equal(original.SubFolder, restored.SubFolder);
        Assert.Equal(original.Metadata, restored.Metadata);
    }

    /// <summary>
    ///     The UI payload is hand-built in ValueCollector and deliberately differs from the
    ///     serialized DTO: no id, and subFolder normalized from "ROOT::Panels" to a path. Pinned so
    ///     an extraction that "tidies" the two into one shape is caught here rather than by the
    ///     client.
    /// </summary>
    [Fact]
    public void TheUiPayloadDiffersFromTheDtoDeliberately()
    {
        FileData value = Sample();

        var uiPayload = new
        {
            fileName = value.FileName ?? "",
            fileType = value.FileType ?? "",
            data = value.Data ?? "",
            isBase64Encoded = value.IsBase64Encoded,
            subFolder = SubFolderPath.ToArchivePath(value.SubFolder),
            metadata = value.Metadata ?? new Dictionary<string, string>()
        };

        var produced = JObject.Parse(JsonConvert.SerializeObject(uiPayload));
        AssertOne("ui", "file-data-full.json", produced);

        Assert.False(produced.ContainsKey("id"), "the UI payload carries no id");
        Assert.NotEqual(value.SubFolder, produced["subFolder"]?.ToString());
    }

    // ============================================================================================
    // Fixture plumbing
    // ============================================================================================

    private static void AssertFixtures(string kind, Func<FileData, string> serialize)
    {
        foreach (var (fileName, value) in Samples())
        {
            AssertOne(kind, fileName, JObject.Parse(serialize(value)));
        }
    }

    private static void AssertOne(string kind, string fileName, JObject produced)
    {
        var dir = Path.Combine(FixturesDir(), kind);
        var path = Path.Combine(dir, fileName);

        if (Environment.GetEnvironmentVariable("UPDATE_FILEDATA_FIXTURES") == "1")
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(path, produced.ToString(Formatting.Indented) + "\n");
            return;
        }

        Assert.True(File.Exists(path),
            $"{kind}/{fileName}: missing — run UPDATE_FILEDATA_FIXTURES=1 dotnet test --filter FileDataContractTests");

        var committed = JToken.Parse(File.ReadAllText(path));
        Assert.True(JToken.DeepEquals(committed, produced),
            $"{kind}/{fileName}: FileData drifted from the committed fixture.\n" +
            $"  committed: {committed.ToString(Formatting.None)}\n" +
            $"  produced:  {produced.ToString(Formatting.None)}\n" +
            "  If the change is intentional, regenerate with UPDATE_FILEDATA_FIXTURES=1.");
    }

    private static string FixturesDir()
    {
        return Path.Combine(FindRepoRoot(), "packages", "schemas", "fixtures", "file-data");
    }

    private static string FindRepoRoot()
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
