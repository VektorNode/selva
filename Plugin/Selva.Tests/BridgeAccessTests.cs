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
    public void Authenticate_WithTheSecret_IsAcceptedAsABrowserTab()
    {
        Assert.True(BridgeAccess.TryAuthenticate("{\"type\":\"authenticate\",\"secret\":\"s3cret\"}", "s3cret",
            out var host));
        Assert.Null(host);
    }

    [Fact]
    public void Authenticate_FromTheRhinoPanel_CarriesItsHost()
    {
        Assert.True(BridgeAccess.TryAuthenticate(
            "{\"type\":\"authenticate\",\"secret\":\"s3cret\",\"host\":\"rhino\"}", "s3cret", out var host));
        Assert.Equal(BridgeAccess.PanelHost, host);
    }

    // A wrong secret must not leak the host it claimed.
    [Fact]
    public void Authenticate_WithAWrongSecret_DeclaresNoHost()
    {
        Assert.False(BridgeAccess.TryAuthenticate(
            "{\"type\":\"authenticate\",\"secret\":\"guess\",\"host\":\"rhino\"}", "s3cret", out var host));
        Assert.Null(host);
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
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"s3cret\",\"host\":\"chrome\"}")]
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"s3cret\",\"host\":\"RHINO\"}")]
    [InlineData("{\"type\":\"authenticate\",\"secret\":\"s3cret\",\"host\":true}")]
    public void Authenticate_AnythingElse_IsRefused(string message)
    {
        Assert.False(BridgeAccess.TryAuthenticate(message, "s3cret", out _));
    }

    [Fact]
    public void SessionUrl_CarriesTheSecretInTheFragment()
    {
        Assert.Equal(
            "http://localhost:51234/?session=abc&wsPort=8765#s=SECRET",
            BridgeAccess.SessionUrl("http://localhost:51234", "abc", 8765, "SECRET"));
    }

    [Fact]
    public void SessionUrl_MarksAPlayerSession()
    {
        Assert.Equal(
            "http://localhost:51234/?session=abc&wsPort=8765&host=rhino&mode=player#s=SECRET",
            BridgeAccess.SessionUrl("http://localhost:51234", "abc", 8765, "SECRET", "rhino", BridgeRole.Player));
    }

    [Fact]
    public void SessionUrl_NamesANonBrowserHostInTheQuery()
    {
        Assert.Equal(
            "http://localhost:51234/?session=abc&wsPort=8765&host=rhino#s=SECRET",
            BridgeAccess.SessionUrl("http://localhost:51234", "abc", 8765, "SECRET", "rhino"));
    }

    [Theory]
    [InlineData(InboundKind.SaveSchema)]
    [InlineData(InboundKind.ApplySyncChanges)]
    [InlineData(InboundKind.SelvaUpload)]
    [InlineData(InboundKind.SelvaSignIn)]
    public void PlayerSession_MayNotWriteTheSchema(InboundKind kind)
    {
        Assert.True(BridgeAccess.IsRefused(kind, BridgeRole.Player));
        Assert.False(BridgeAccess.IsRefused(kind, BridgeRole.Author));
    }

    [Theory]
    [InlineData(InboundKind.ValueUpdate)]
    [InlineData(InboundKind.RequestSyncPreview)]
    [InlineData(InboundKind.PickGeometry)]
    [InlineData(InboundKind.Trigger)]
    [InlineData(InboundKind.CancelSolve)]
    public void PlayerSession_MaySetValuesAndRead(InboundKind kind)
    {
        Assert.False(BridgeAccess.IsRefused(kind, BridgeRole.Player));
    }

    [Theory]
    [InlineData(InboundKind.CloseDefinition)]
    [InlineData(InboundKind.EditInGrasshopper)]
    public void AuthorSession_HasNoPlayerCommands(InboundKind kind)
    {
        Assert.True(BridgeAccess.IsRefused(kind, BridgeRole.Author));
        Assert.False(BridgeAccess.IsRefused(kind, BridgeRole.Player));
    }

    // A browser tab on the same bridge must not open a dialog or a viewport prompt inside Rhino.
    [Theory]
    [InlineData(InboundKind.HostPickFile)]
    [InlineData(InboundKind.HostSaveFile)]
    [InlineData(InboundKind.PickGeometry)]
    [InlineData(InboundKind.ClearGeometry)]
    public void PromptMessages_AreTheRhinoPanelsOnly(InboundKind kind)
    {
        Assert.True(BridgeAccess.IsRefusedFrom(kind, null));
        Assert.False(BridgeAccess.IsRefusedFrom(kind, BridgeAccess.PanelHost));
    }

    [Theory]
    [InlineData(InboundKind.ValueUpdate)]
    [InlineData(InboundKind.Trigger)]
    [InlineData(InboundKind.RequestInitialData)]
    [InlineData(InboundKind.CancelSolve)]
    public void EverythingElse_ComesFromAnyHost(InboundKind kind)
    {
        Assert.False(BridgeAccess.IsRefusedFrom(kind, null));
        Assert.False(BridgeAccess.IsRefusedFrom(kind, BridgeAccess.PanelHost));
    }

    // The page reads the same file (bridge-handshake.test.ts), so the two sides can't drift.
    [Fact]
    public void Handshake_MatchesTheSharedFixture()
    {
        var fixture = JObject.Parse(File.ReadAllText(
            Path.Combine(TestPaths.RepoRoot(), "packages", "schemas", "fixtures", "bridge-handshake.json")));
        var authenticate = (JObject)fixture["authenticate"]!;
        var fromPanel = (JObject)fixture["authenticateFromPanel"]!;

        Assert.True(BridgeAccess.TryAuthenticate(authenticate.ToString(), (string)authenticate["secret"]!, out _));
        Assert.True(BridgeAccess.TryAuthenticate(fromPanel.ToString(), (string)fromPanel["secret"]!, out var host));
        Assert.Equal(BridgeAccess.PanelHost, host);
        Assert.True(JToken.DeepEquals(fixture["authenticated"],
            JObject.Parse(BridgeAccess.AuthenticatedMessage(BridgeRole.Author))));
        Assert.True(JToken.DeepEquals(fixture["authenticatedAsPlayer"],
            JObject.Parse(BridgeAccess.AuthenticatedMessage(BridgeRole.Player))));
        Assert.Equal((int)fixture["unauthorizedCloseCode"]!, BridgeAccess.UnauthorizedCloseCode);
        Assert.Equal((long)fixture["maxHostFileBytes"]!, Selva.GH.Config.AppConfig.ValueLimits.MaxFileSizeBytes);
    }
}
