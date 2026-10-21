using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using Selva.GH.Features.SelvaUpload.Services;

namespace Selva.Tests;

/// <summary>
///     The account manager against a fake Selva and a fake browser that follows the authorize URL
///     back to the plugin's loopback listener, the way a real one would after the user approves.
/// </summary>
public sealed class SelvaAccountManagerTests : IDisposable
{
    private const string Origin = "https://selva.example.com";
    private const string IssuedKey = "selva_Abc123XYZabc123XYZabc123XYZabc1GCgGf";

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "selva-manager-" + Guid.NewGuid());
    private readonly FakeSelva _selva = new();
    private readonly MemoryCredentialStore _os = new();

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, true);
        }
    }

    private SelvaAccountManager Manager(Action<string>? browser = null, ICredentialStore? store = null,
        Func<DateTimeOffset>? now = null) =>
        new(store ?? _os, Path.Combine(_dir, "accounts.json"), () => _selva, "ua",
            browser ?? (url => Approve(url)), now ?? (() => DateTimeOffset.Parse("2026-01-01T00:00:00Z")));

    // -------------------------------------------------------------------------

    [Fact]
    public async Task Connect_RemembersTheNormalisedInstance()
    {
        var manager = Manager();
        await manager.ConnectAsync("Selva.Example.com/library", CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Equal(Origin, account.Origin);
        Assert.Equal("signedOut", account.Status);
        Assert.Null(account.Message);
    }

    [Fact]
    public async Task Connect_ToSomethingThatIsNotSelva_SaysSoAndKeepsThePreviousInstance()
    {
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);
        _selva.MetadataStatus = HttpStatusCode.NotFound;

        await manager.ConnectAsync("https://other.example.com", CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Equal(Origin, account.Origin);
        Assert.NotNull(account.Message);
    }

    [Fact]
    public async Task SignIn_ThroughTheBrowser_StoresTheKeyAndShowsWhoAndWhere()
    {
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.SignInAsync(CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Null(account.Message);
        Assert.Equal("signedIn", account.Status);
        Assert.Equal("ada@example.com", account.User!.Email);
        Assert.Equal("Studio", account.Org!.Name);
        Assert.Equal("2026-02-14T12:00:00Z", account.ExpiresAt);
        Assert.Empty(account.ExtraScopes);
        Assert.Equal(IssuedKey, _os.Load(Origin));
        Assert.True(_selva.VerifierMatchedChallenge);
        Assert.DoesNotContain("selva_", Newtonsoft.Json.JsonConvert.SerializeObject(account));
        Assert.DoesNotContain("selva_", File.ReadAllText(Path.Combine(_dir, "accounts.json")));
    }

    [Fact]
    public async Task SignIn_AsksForUploadOnlyWithPkceAndThisInstanceAsResource()
    {
        string? opened = null;
        var manager = Manager(url =>
        {
            opened = url;
            Approve(url);
        });
        await manager.ConnectAsync(Origin, CancellationToken.None);
        await manager.SignInAsync(CancellationToken.None);

        Assert.StartsWith("https://selva.example.com/oauth/authorize?", opened);
        Assert.Contains("client_id=selva-grasshopper", opened);
        Assert.Contains("scope=upload", opened);
        Assert.Contains("code_challenge_method=S256", opened);
        Assert.Contains("resource=https%3A%2F%2Fselva.example.com", opened);
        Assert.Contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A", opened);
    }

    [Fact]
    public async Task SignIn_DeniedInTheBrowser_ReadsAsCancelled()
    {
        var manager = Manager(url => Callback(url, "error=access_denied"));
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.SignInAsync(CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Equal("signedOut", account.Status);
        Assert.Contains("cancelled", account.Message);
        Assert.Null(_os.Load(Origin));
    }

    [Fact]
    public async Task SignIn_AnsweredByAnotherIssuer_StoresNothing()
    {
        var manager = Manager(url => Callback(url, "code=the-code", issuer: "https://evil.example"));
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.SignInAsync(CancellationToken.None);

        Assert.Equal("signedOut", manager.Snapshot().Status);
        Assert.Null(_os.Load(Origin));
        Assert.False(_selva.TokenEndpointCalled);
    }

    [Fact]
    public async Task SignIn_CancelledFromTheWebUi_StopsWaiting()
    {
        SelvaAccountManager? manager = null;
        manager = Manager(_ => Task.Run(async () =>
        {
            await Task.Delay(50);
            manager!.Cancel();
        }));
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.SignInAsync(CancellationToken.None);

        Assert.Equal("Sign-in was cancelled.", manager.Snapshot().Message);
    }

    [Fact]
    public async Task SignIn_WhenTheOsStoreRefuses_KeepsTheKeyForThisSessionAndSaysSo()
    {
        var manager = Manager(store: new RefusingStore());
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.SignInAsync(CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Equal("signedIn", account.Status);
        Assert.Equal("memory", account.Storage);
    }

    [Fact]
    public async Task PastedKey_WithMoreThanUploadRights_IsAcceptedWithAWarning()
    {
        _selva.Scopes = new[] { "read:all", "write:all" };
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);

        await manager.UseApiKeyAsync(Origin, "  " + IssuedKey + "\n", CancellationToken.None);

        var account = manager.Snapshot();
        Assert.Equal("signedIn", account.Status);
        Assert.Equal(new[] { "write:all" }, account.ExtraScopes);
    }

    [Fact]
    public async Task PastedKey_ThatIsMalformed_IsRefusedBeforeAnythingIsSent()
    {
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);
        var before = _selva.Requests;

        await manager.UseApiKeyAsync(Origin, "selva_typo", CancellationToken.None);

        Assert.Equal(before, _selva.Requests);
        Assert.Equal("signedOut", manager.Snapshot().Status);
        Assert.NotNull(manager.Snapshot().Message);
    }

    // The dialog named one instance; another page may have switched the active one meanwhile.
    [Fact]
    public async Task PastedKey_GoesOnlyToTheInstanceTheDialogNamed()
    {
        var manager = Manager();
        await manager.ConnectAsync("https://other.example.com", CancellationToken.None);
        var before = _selva.Requests;

        await manager.UseApiKeyAsync(Origin, IssuedKey, CancellationToken.None);

        Assert.Equal(before, _selva.Requests);
        Assert.Equal("signedOut", manager.Snapshot().Status);
        Assert.NotNull(manager.Snapshot().Message);
    }

    [Fact]
    public async Task SignOut_RevokesTheKeyAtSelvaAndForgetsIt()
    {
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);
        await manager.SignInAsync(CancellationToken.None);

        await manager.SignOutAsync(CancellationToken.None);

        Assert.True(_selva.Revoked);
        Assert.Null(_os.Load(Origin));
        Assert.Equal("signedOut", manager.Snapshot().Status);
        Assert.Null(manager.Snapshot().Message);
        Assert.Equal(new[] { Origin }, manager.Snapshot().KnownOrigins);
    }

    [Fact]
    public async Task SignOut_WhenSelvaCannotBeReached_ForgetsAnywayAndSaysTheKeyStaysValid()
    {
        var manager = Manager();
        await manager.ConnectAsync(Origin, CancellationToken.None);
        await manager.SignInAsync(CancellationToken.None);
        _selva.RevokeStatus = HttpStatusCode.BadGateway;

        await manager.SignOutAsync(CancellationToken.None);

        Assert.Null(_os.Load(Origin));
        Assert.Contains("/team/tokens", manager.Snapshot().Message);
    }

    [Fact]
    public async Task ExpiredSignIn_IsDroppedWhenUsed()
    {
        var now = DateTimeOffset.Parse("2026-01-01T00:00:00Z");
        var manager = Manager(now: () => now);
        await manager.ConnectAsync(Origin, CancellationToken.None);
        await manager.SignInAsync(CancellationToken.None);
        Assert.NotNull(manager.Session());

        now = DateTimeOffset.Parse("2026-03-01T00:00:00Z");

        Assert.Null(manager.Session());
        Assert.Null(_os.Load(Origin));
        Assert.Contains("ran out", manager.Snapshot().Message);
    }

    [Fact]
    public async Task SignIn_SurvivesARestartThroughTheOsStore()
    {
        var first = Manager();
        await first.ConnectAsync(Origin, CancellationToken.None);
        await first.SignInAsync(CancellationToken.None);

        var second = Manager();

        Assert.Equal("signedIn", second.Snapshot().Status);
        Assert.Equal(IssuedKey, second.Session()!.Token);
    }

    // -------------------------------------------------------------------------
    // Fake browser
    // -------------------------------------------------------------------------

    private void Approve(string authorizeUrl) => Callback(authorizeUrl, "code=the-code");

    private void Callback(string authorizeUrl, string result, string issuer = Origin)
    {
        var query = new Uri(authorizeUrl).Query.TrimStart('?').Split('&')
            .Select(p => p.Split('='))
            .ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]));
        _selva.Challenge = query["code_challenge"];

        var redirect = query["redirect_uri"];
        var target = $"{redirect}?{result}&state={Uri.EscapeDataString(query["state"])}" +
                     $"&iss={Uri.EscapeDataString(issuer)}";
        _ = Task.Run(async () =>
        {
            using var http = new HttpClient();
            await http.GetAsync(target);
        });
    }

    // -------------------------------------------------------------------------
    // Fake Selva
    // -------------------------------------------------------------------------

    private sealed class RefusingStore : ICredentialStore
    {
        public string Kind => "keychain";
        public bool TrySave(string origin, string secret) => false;
        public string? Load(string origin) => null;
        public void Delete(string origin) { }
    }

    private sealed class FakeSelva : HttpMessageHandler
    {
        public HttpStatusCode MetadataStatus = HttpStatusCode.OK;
        public HttpStatusCode RevokeStatus = HttpStatusCode.NoContent;
        public string[] Scopes = { "upload:all" };
        public string? Challenge;
        public bool VerifierMatchedChallenge;
        public bool TokenEndpointCalled;
        public bool Revoked;
        public int Requests;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref Requests);
            var path = request.RequestUri!.AbsolutePath;
            var origin = request.RequestUri.GetLeftPart(UriPartial.Authority);
            var authorized = request.Headers.Authorization?.Parameter == IssuedKey;

            switch (request.Method.Method, path)
            {
                case ("GET", "/.well-known/oauth-authorization-server"):
                    return MetadataStatus != HttpStatusCode.OK
                        ? new HttpResponseMessage(MetadataStatus)
                        : Json(new JObject
                        {
                            ["issuer"] = origin,
                            ["authorization_endpoint"] = origin + "/oauth/authorize",
                            ["token_endpoint"] = origin + "/oauth/token",
                            ["code_challenge_methods_supported"] = new JArray("S256"),
                            ["scopes_supported"] = new JArray("read", "solve", "upload")
                        });

                case ("POST", "/oauth/token"):
                {
                    TokenEndpointCalled = true;
                    var form = (await request.Content!.ReadAsStringAsync()).Split('&')
                        .Select(p => p.Split('='))
                        .ToDictionary(p => p[0], p => Uri.UnescapeDataString(p[1]));
                    using var sha = SHA256.Create();
                    var computed = Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(form["code_verifier"])))
                        .TrimEnd('=').Replace('+', '-').Replace('/', '_');
                    VerifierMatchedChallenge = computed == Challenge && form["code"] == "the-code" &&
                                               form["client_id"] == "selva-grasshopper";
                    return VerifierMatchedChallenge
                        ? Json(new JObject
                        {
                            ["access_token"] = IssuedKey, ["token_type"] = "Bearer", ["expires_in"] = 2592000,
                            ["scope"] = "upload"
                        })
                        : Json(new JObject { ["error"] = "invalid_grant" }, HttpStatusCode.BadRequest);
                }

                case ("GET", "/api/v1/me") when authorized:
                    return Json(new JObject
                    {
                        ["userId"] = "user-1",
                        ["email"] = "ada@example.com",
                        ["displayName"] = "Ada",
                        ["actingOrgId"] = "org-1",
                        ["apiToken"] = new JObject
                        {
                            ["id"] = "token-1",
                            ["scopes"] = new JArray(Scopes.Cast<object>().ToArray()),
                            ["expiresAt"] = "2026-02-14T12:00:00Z"
                        }
                    });

                case ("GET", "/api/v1/orgs/org-1") when authorized:
                    return Json(new JObject { ["id"] = "org-1", ["name"] = "Studio" });

                case ("DELETE", "/api/v1/me/token") when authorized:
                    Revoked = RevokeStatus == HttpStatusCode.NoContent;
                    return new HttpResponseMessage(RevokeStatus);
            }

            return Json(new JObject { ["message"] = "Unauthorized" }, HttpStatusCode.Unauthorized);
        }

        private static HttpResponseMessage Json(JObject body, HttpStatusCode status = HttpStatusCode.OK) =>
            new(status) { Content = new StringContent(body.ToString(), Encoding.UTF8, "application/json") };
    }
}
