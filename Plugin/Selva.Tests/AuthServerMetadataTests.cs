using Newtonsoft.Json.Linq;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

public class AuthServerMetadataTests
{
    private const string Origin = "https://selva.example.com";

    private static JObject Valid() => JObject.Parse(@"{
        ""issuer"": ""https://selva.example.com"",
        ""authorization_endpoint"": ""https://selva.example.com/oauth/authorize"",
        ""token_endpoint"": ""https://selva.example.com/oauth/token"",
        ""registration_endpoint"": ""https://selva.example.com/oauth/register"",
        ""response_types_supported"": [""code""],
        ""code_challenge_methods_supported"": [""S256""],
        ""scopes_supported"": [""read"", ""solve"", ""upload""],
        ""authorization_response_iss_parameter_supported"": true
    }");

    [Fact]
    public void Metadata_OfThisInstance_IsAccepted()
    {
        Assert.True(AuthServerMetadata.TryParse(Valid().ToString(), Origin, out var metadata, out var error), error);
        Assert.Equal("https://selva.example.com/oauth/authorize", metadata!.AuthorizationEndpoint);
        Assert.Equal("https://selva.example.com/oauth/token", metadata.TokenEndpoint);
    }

    [Fact]
    public void Metadata_OfALoopbackDevInstance_MayUseHttp()
    {
        var json = Valid().ToString().Replace("https://selva.example.com", "http://localhost:5199");
        Assert.True(AuthServerMetadata.TryParse(json, "http://localhost:5199", out _, out var error), error);
    }

    [Theory]
    [InlineData("issuer", "https://selva.example.com/")]
    [InlineData("issuer", "https://evil.example")]
    [InlineData("issuer", null)]
    [InlineData("authorization_endpoint", "https://evil.example/oauth/authorize")]
    [InlineData("authorization_endpoint", "http://selva.example.com/oauth/authorize")]
    [InlineData("authorization_endpoint", "ms-settings:privacy")]
    [InlineData("authorization_endpoint", "/oauth/authorize")]
    [InlineData("authorization_endpoint", null)]
    [InlineData("token_endpoint", "https://selva.example.com.evil.example/oauth/token")]
    [InlineData("token_endpoint", null)]
    public void Metadata_PointingAnywhereElse_IsRefused(string field, string? value)
    {
        var json = Valid();
        json[field] = value == null ? null : JToken.FromObject(value);
        if (value == null)
        {
            json.Remove(field);
        }

        Assert.False(AuthServerMetadata.TryParse(json.ToString(), Origin, out var metadata, out var error));
        Assert.Null(metadata);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void Metadata_WithoutS256_IsRefused()
    {
        var json = Valid();
        json["code_challenge_methods_supported"] = new JArray("plain");
        Assert.False(AuthServerMetadata.TryParse(json.ToString(), Origin, out _, out _));
    }

    // An older Selva can't take uploads; this is how it says so.
    [Fact]
    public void Metadata_WithoutTheUploadScope_IsRefusedAsTooOld()
    {
        var json = Valid();
        json["scopes_supported"] = new JArray("read", "solve");
        Assert.False(AuthServerMetadata.TryParse(json.ToString(), Origin, out _, out var error));
        Assert.Contains("update", error);
    }

    [Theory]
    [InlineData("")]
    [InlineData("<html>Sign in</html>")]
    [InlineData("[]")]
    public void Metadata_ThatIsNotAnObject_IsRefused(string body)
    {
        Assert.False(AuthServerMetadata.TryParse(body, Origin, out _, out _));
    }
}
