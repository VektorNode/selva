using Newtonsoft.Json.Linq;
using Selva.GH.Features.UIBuilder.Services.Communication;

namespace Selva.Tests;

public class BridgeAccessTests
{
    private static readonly string[] Allowed = { "http://localhost:51234", "http://127.0.0.1:51234" };

    [Theory]
    [InlineData("http://localhost:51234")]
    [InlineData("http://127.0.0.1:51234")]
    [InlineData("HTTP://LOCALHOST:51234")]
    public void Origin_ServedByThisComponent_IsAllowed(string origin)
    {
        Assert.True(BridgeAccess.IsAllowedOrigin(origin, Allowed));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("https://evil.example")]
    [InlineData("http://localhost:5173")]
    [InlineData("http://localhost:51234.evil.example")]
    [InlineData("http://localhost:512345")]
    [InlineData("https://localhost:51234")]
    [InlineData("http://[::1]:51234")]
    public void Origin_AnythingElse_IsRefused(string? origin)
    {
        Assert.False(BridgeAccess.IsAllowedOrigin(origin, Allowed));
    }

    [Theory]
    [InlineData("localhost:51234")]
    [InlineData("127.0.0.1:51234")]
    [InlineData("LocalHost:51234")]
    public void Host_LoopbackOnThisPort_IsAllowed(string host)
    {
        Assert.True(BridgeAccess.IsAllowedHost(host, 51234));
    }

    // A rebinding attack resolves its own name to 127.0.0.1; the browser still sends that name.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("evil.example:51234")]
    [InlineData("localhost")]
    [InlineData("localhost:80")]
    [InlineData("localhost:51234.evil.example")]
    [InlineData("127.0.0.1.nip.io:51234")]
    public void Host_AnythingElse_IsRefused(string? host)
    {
        Assert.False(BridgeAccess.IsAllowedHost(host, 51234));
    }

    [Fact]
    public void LoopbackOrigins_NameBothSpellingsOfLoopback()
    {
        Assert.Equal(new[] { "http://localhost:5173", "http://127.0.0.1:5173" }, BridgeAccess.LoopbackOrigins(5173));
    }

    [Fact]
    public void NewSecret_Is32RandomBytesUrlSafe()
    {
        var a = BridgeAccess.NewSecret();
        var b = BridgeAccess.NewSecret();

        Assert.Equal(43, a.Length);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", a);
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Authenticate_WithTheSecret_IsAccepted()
    {
        Assert.True(BridgeAccess.IsValidAuthenticate("{\"type\":\"authenticate\",\"secret\":\"s3cret\"}", "s3cret"));
    }

    [Theory]
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"wrong!\"}")]
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"s3cre\"}")]
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"\"}")]
    [InlineData("{\"type\":\"authenticate\"}")]
    [InlineData("{\"type\":\"authenticate\",\"secret\":[\"s3cret\"]}")]
    [InlineData("{\"type\":\"requestInitialData\",\"secret\":\"s3cret\"}")]
    [InlineData("{\"secret\":\"s3cret\"}")]
    [InlineData("[\"s3cret\"]")]
    [InlineData("s3cret")]
    [InlineData("")]
    public void Authenticate_AnythingElse_IsRefused(string message)
    {
        Assert.False(BridgeAccess.IsValidAuthenticate(message, "s3cret"));
    }

    [Fact]
    public void SessionUrl_CarriesTheSecretInTheFragment()
    {
        Assert.Equal(
            "http://localhost:51234/?session=abc&wsPort=8765#s=SECRET",
            BridgeAccess.SessionUrl("http://localhost:51234", "abc", 8765, "SECRET"));
    }

    // The page reads the same file (bridge-handshake.test.ts), so the two sides can't drift.
    [Fact]
    public void Handshake_MatchesTheSharedFixture()
    {
        var fixture = JObject.Parse(File.ReadAllText(
            Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "bridge-handshake.json")));
        var authenticate = (JObject)fixture["authenticate"]!;

        Assert.True(BridgeAccess.IsValidAuthenticate(authenticate.ToString(), (string)authenticate["secret"]!));
        Assert.True(JToken.DeepEquals(fixture["authenticated"], JObject.Parse(BridgeAccess.AuthenticatedMessage)));
        Assert.Equal((int)fixture["unauthorizedCloseCode"]!, BridgeAccess.UnauthorizedCloseCode);
    }
}
