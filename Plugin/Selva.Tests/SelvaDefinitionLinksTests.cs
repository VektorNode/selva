using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class SelvaDefinitionLinksTests
{
    private static SelvaDefinitionLink Link(string origin, int version) => new()
    {
        Origin = origin,
        DefinitionGuid = "44444444-4444-4444-8444-444444444444",
        VersionId = "v-" + version,
        VersionNumber = version
    };

    [Fact]
    public void Links_RoundTrip()
    {
        var json = SelvaDefinitionLinks.Serialize(new[] { Link("https://a.example", 3) });
        var link = Assert.Single(SelvaDefinitionLinks.Parse(json));
        Assert.Equal(3, link.VersionNumber);
        Assert.Equal("https://a.example", link.Origin);
    }

    [Fact]
    public void With_KeepsOneLinkPerInstance()
    {
        var links = SelvaDefinitionLinks.With(new[] { Link("https://a.example", 3), Link("https://b.example", 1) },
            Link("https://a.example", 4));

        Assert.Equal(2, links.Count);
        Assert.Equal(4, SelvaDefinitionLinks.For(links, "https://a.example")!.VersionNumber);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("{ not json")]
    [InlineData("{}")]
    [InlineData(@"[{ ""origin"": ""https://a.example/path"", ""definitionGuid"": ""44444444-4444-4444-8444-444444444444"", ""versionNumber"": 1 }]")]
    [InlineData(@"[{ ""origin"": ""https://a.example"", ""definitionGuid"": ""../../etc"", ""versionNumber"": 1 }]")]
    public void Unreadable_IsNoLinks(string? json)
    {
        Assert.Empty(SelvaDefinitionLinks.Parse(json));
    }
}
