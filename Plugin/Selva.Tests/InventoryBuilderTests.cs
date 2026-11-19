using Newtonsoft.Json.Linq;
using Selva.GH.Features.Inventory.Services;

namespace Selva.Tests;

public class InventoryBuilderTests
{
    static readonly Guid SelvaLib = Guid.Parse("69ef43c6-0bc8-4b49-8e4d-a27f732cc10b");
    static readonly Guid OtherLib = Guid.Parse("2e872be7-90c2-496a-b80c-f2623c249347");

    static JObject Build(
        IEnumerable<ArchiveLibrary>? saved = null,
        IEnumerable<LoadedLibrary>? loaded = null,
        IEnumerable<CanvasObject>? objects = null,
        IEnumerable<CanvasValue>? values = null,
        IEnumerable<CanvasScript>? scripts = null,
        IEnumerable<CanvasWire>? wires = null,
        IEnumerable<ArchiveObject>? unloaded = null) =>
        JObject.Parse(InventoryBuilder.ToJson(InventoryBuilder.Build("1.2.3",
            saved ?? [], loaded ?? [], objects ?? [], values ?? [], scripts ?? [], wires ?? [], unloaded)));

    [Fact]
    public void Unloaded_objects_keep_their_type_and_library()
    {
        var id = Guid.NewGuid();
        var type = Guid.NewGuid();
        var json = Build(unloaded: [new(id, type, "Repeat", SelvaLib), new(Guid.NewGuid(), type, "Mystery", Guid.Empty)]);
        var unloaded = (JArray)json["unloaded"]!;
        Assert.Equal(2, unloaded.Count);
        Assert.Equal("Repeat", (string?)unloaded[0]["name"]);
        Assert.Equal(type.ToString(), (string?)unloaded[0]["type"]);
        Assert.Equal(SelvaLib.ToString(), (string?)unloaded[0]["library"]);
        Assert.Null(unloaded[1]["library"]);
    }

    [Fact]
    public void Core_libraries_collapse_and_count_as_loaded()
    {
        var json = Build(saved:
        [
            new(Guid.Empty, "Grasshopper", "Robert McNeel & Associates", "9.0"),
            new(Guid.Empty, "Grasshopper", "Robert McNeel & Associates", "9.0"),
            new(SelvaLib, "Selva", "VektorNode", "0.25.0.0"),
            new(OtherLib, "Canopy", "VektorNode", "1.3.0.0")
        ], loaded: [new(SelvaLib, "Selva", "0.26.0.0")]);

        var libs = (JArray)json["libraries"]!;
        Assert.Equal(3, libs.Count);
        Assert.True((bool)libs[0]["core"]!);
        Assert.Equal("9.0", (string?)libs[0]["serverVersion"]);
        var canopy = libs.Single(l => (string?)l["name"] == "Canopy");
        Assert.Null(canopy["serverVersion"]);
        Assert.False((bool)canopy["core"]!);
        Assert.Equal("0.26.0.0", (string?)libs.Single(l => (string?)l["name"] == "Selva")["serverVersion"]);
    }

    [Fact]
    public void Required_flags_are_written_even_when_false()
    {
        var json = Build(objects: [new(Guid.NewGuid(), Guid.NewGuid(), "Loft", "Loft", Guid.Empty, false)]);
        var c = json["components"]![0]!;
        Assert.False((bool)c["obsolete"]!);
        Assert.Null(c["nickname"]);
        Assert.Null(c["library"]);
    }

    [Fact]
    public void Scripts_keep_fingerprints_never_source()
    {
        const string source = "var a = 1;  \r\nvar b = 2;\r\n\r\n";
        var json = Build(scripts: [new(Guid.NewGuid(), "calc", "csharp", source)]);
        var s = json["scripts"]![0]!;
        Assert.Equal(2, (int)s["lineCount"]!);
        Assert.Equal(InventoryBuilder.LineHash("var a = 1;"), (string?)s["lineHashes"]![0]);
        Assert.DoesNotContain("var a", json.ToString());
        Assert.Equal(InventoryBuilder.Sha256(InventoryBuilder.Normalize(source)), (string?)s["sha256"]);
    }

    [Fact]
    public void A_secret_is_named_and_its_value_withheld()
    {
        var json = Build(
            values: [new("v1", null, "panel", "key", "api_key = \"abcdef123456\"")],
            scripts: [new(Guid.NewGuid(), "s", "python3", "token = 'ghp_" + new string('a', 36) + "'")]);
        var v = json["values"]![0]!;
        Assert.Equal("", (string?)v["text"]);
        Assert.Contains("password-assignment", v["secrets"]!.Values<string>());
        Assert.Contains("github-token", json["scripts"]![0]!["secrets"]!.Values<string>());
        Assert.DoesNotContain("abcdef123456", json.ToString());
    }

    [Fact]
    public void Long_values_are_cut_but_hashed_whole()
    {
        var text = new string('x', 600);
        var v = Build(values: [new("v1", null, "panel", "p", text)])["values"]![0]!;
        Assert.Equal(InventoryBuilder.MaxValueText + 1, ((string)v["text"]!).Length);
        Assert.Equal(InventoryBuilder.Sha256(text), (string?)v["sha256"]);
    }

    [Fact]
    public void Wire_hash_ignores_order()
    {
        const string a = "c1/o0", b = "c2/i0", c = "p3";
        var one = Build(wires: [new(a, b), new(b, c)])["wires"]!;
        var two = Build(wires: [new(b, c), new(a, b), new(a, b)])["wires"]!;
        Assert.Equal(2, (int)two["count"]!);
        Assert.Equal((string?)one["sha256"], (string?)two["sha256"]);
    }

    [Theory]
    [InlineData("*.*.csharp@*.*", "csharp")]
    [InlineData("*.*.python@3.*", "python3")]
    [InlineData("*.*.python@2.*", "ironpython2")]
    [InlineData(null, "unknown")]
    public void Language_from_spec(string? spec, string expected) =>
        Assert.Equal(expected, InventoryBuilder.LanguageFromSpec(spec));

    [Theory]
    [InlineData("-----BEGIN RSA PRIVATE KEY-----", "private-key")]
    [InlineData("AKIAABCDEFGHIJKLMNOP", "aws-access-key")]
    [InlineData("Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "bearer-token")]
    [InlineData("postgres://user:hunter2@db.example.com/x", "connection-string")]
    [InlineData("password = \"hunter22\"", "password-assignment")]
    public void Secret_rules(string text, string rule) => Assert.Contains(rule, SecretScanner.Scan(text));

    [Theory]
    [InlineData("password = input()")]
    [InlineData("api_key = os.environ[\"KEY\"]")]
    [InlineData("https://example.com/path")]
    public void Ordinary_code_is_not_flagged(string text) => Assert.Empty(SecretScanner.Scan(text));
}
